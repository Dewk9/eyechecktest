/**
 * Thin HTTP controllers: read validated input, call a service, send the
 * standard envelope { success, data }. No business logic lives here.
 */
import crypto from 'node:crypto';
import { ok } from '../utils/helpers.js';
import { AppError } from '../utils/app-error.js';
import { config } from '../config/env.js';
import { setSessionCookies, clearSessionCookies, forgetAccessToken, COOKIES } from '../middleware/auth.js';
import * as authService from '../services/auth.service.js';
import * as profileService from '../services/profile.service.js';
import * as patientService from '../services/patient.service.js';
import * as historyService from '../services/medical-history.service.js';
import * as visionService from '../services/vision-test.service.js';
import * as screeningService from '../services/screening.service.js';
import * as aiService from '../services/ai.service.js';
import * as consentService from '../services/consent.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as adminService from '../services/admin.service.js';
import * as datasetService from '../services/dataset.service.js';
import * as rfAdmin from '../services/roboflow-admin.service.js';
import { getStatus as aiStatus, getActiveModel } from '../roboflow/roboflow.service.js';
import { getConfidenceThreshold, getConsentVersion, getActiveModelConfig } from '../services/settings.service.js';
import { ASSESSMENT_VERSION, ASSESSMENT_VALIDATED } from '../services/assessment/risk-engine.js';
import { VISION_CRITERIA } from '../services/assessment/summaries.js';

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const h = asyncHandler;

// ---------------- auth ----------------
export const auth = {
  register: h(async (req, res) => {
    const profile = await authService.register(req.body);
    ok(res, { profile: profileService.publicProfile(profile) }, 201);
  }),
  login: h(async (req, res) => {
    const { session, profile } = await authService.login(req.body);
    setSessionCookies(res, session, req.body.remember);
    ok(res, { profile: profileService.publicProfile(profile), remember: req.body.remember });
  }),
  logout: h(async (req, res) => {
    forgetAccessToken(req.cookies?.[COOKIES.access]);
    forgetAccessToken(req.auth?.token);
    await authService.logout(req.auth?.token, req.auth?.userId);
    clearSessionCookies(res);
    ok(res, { loggedOut: true });
  }),
  me: h(async (req, res) => {
    ok(res, req.auth ? { profile: profileService.publicProfile(req.auth.profile), remembered: req.cookies?.[COOKIES.remember] === '1' } : null);
  }),
  changePassword: h(async (req, res) => {
    await authService.changePassword(req.auth.profile, req.body.current_password, req.body.new_password);
    ok(res, { changed: true });
  }),
};

// ---------------- profile ----------------
export const profiles = {
  me: h(async (req, res) => ok(res, profileService.publicProfile(req.auth.profile))),
  update: h(async (req, res) => ok(res, await profileService.updateMe(req.auth, req.body))),
  remove: h(async (req, res) => {
    await profileService.deleteMyAccount(req.auth, req.body.password);
    forgetAccessToken(req.cookies?.[COOKIES.access]);
    forgetAccessToken(req.auth?.token);
    clearSessionCookies(res);
    ok(res, { deleted: true });
  }),
};

// ---------------- patients ----------------
export const patients = {
  list: h(async (req, res) => ok(res, await patientService.listPatients(req.auth, req.validatedQuery))),
  create: h(async (req, res) => ok(res, await patientService.createPatient(req.auth, req.body), 201)),
  get: h(async (req, res) => ok(res, await patientService.getPatient(req.auth, req.params.id))),
  update: h(async (req, res) => ok(res, await patientService.updatePatient(req.auth, req.params.id, req.body))),
  remove: h(async (req, res) => { await patientService.deletePatient(req.auth, req.params.id); ok(res, { deleted: true }); }),
};

// ---------------- medical history ----------------
export const history = {
  create: h(async (req, res) => ok(res, await historyService.createHistory(req.auth, req.body), 201)),
  update: h(async (req, res) => ok(res, await historyService.updateHistory(req.auth, req.params.id, req.body))),
  me: h(async (req, res) => ok(res, await historyService.getMyHistory(req.auth))),
  record: h(async (req, res) => ok(res, await historyService.getHistory(req.auth, req.params.id))),
  byPatient: h(async (req, res) => ok(res, await historyService.listPatientHistories(req.auth, req.params.patientId))),
};

// ---------------- vision tests ----------------
export const vision = {
  create: h(async (req, res) => ok(res, await visionService.createVisionTest(req.auth, req.body), 201)),
  list: h(async (req, res) => ok(res, await visionService.listVisionTests(req.auth, req.query.patient_id || null))),
  get: h(async (req, res) => ok(res, await visionService.getVisionTest(req.auth, req.params.id))),
  byScreening: h(async (req, res) => ok(res, await visionService.getVisionTestForScreening(req.auth, req.params.screeningId))),
  criteria: h(async (req, res) => ok(res, VISION_CRITERIA)),
};

// ---------------- screenings / results ----------------
export const screenings = {
  create: h(async (req, res) => ok(res, await screeningService.createScreening(req.auth, req.body, req.file), 201)),
  list: h(async (req, res) => ok(res, await screeningService.listScreenings(req.auth, req.validatedQuery))),
  get: h(async (req, res) => ok(res, await screeningService.getResult(req.auth, req.params.id))),
  remove: h(async (req, res) => { await screeningService.deleteScreening(req.auth, req.params.id); ok(res, { deleted: true }); }),
  result: h(async (req, res) => ok(res, await screeningService.getResult(req.auth, req.params.screeningId))),
  save: h(async (req, res) => ok(res, await screeningService.saveResult(req.auth, req.params.screeningId))),
};

// ---------------- AI ----------------
export const ai = {
  analyze: h(async (req, res) => ok(res, await aiService.analyzeScreening(req.auth, req.body.screening_id))),
  status: h(async (req, res) => {
    // the threshold lives in the DB; if it is unreachable the AI status is still reported truthfully
    const [s, threshold] = await Promise.all([aiStatus(), getConfidenceThreshold().catch(() => null)]);
    ok(res, { ...s, threshold, assessment: { version: ASSESSMENT_VERSION, validated: ASSESSMENT_VALIDATED } });
  }),
  models: h(async (req, res) => {
    try {
      const m = await getActiveModel();
      ok(res, { active: { mode: m.mode, project: m.project, name: m.projectName, type: m.projectType, version: m.version, model_id: m.modelId ?? null, trained: m.hasTrainedModel, classes: m.capabilities.classes, supported: m.capabilities.supported } });
    } catch (err) {
      ok(res, { active: null, reason: err.message, configured: Boolean(await getActiveModelConfig()) });
    }
  }),
};

// ---------------- consents ----------------
export const consents = {
  list: h(async (req, res) => ok(res, await consentService.listMyConsents(req.auth))),
  withdraw: h(async (req, res) => ok(res, await consentService.withdrawConsent(req.auth, req.params.id))),
  version: h(async (req, res) => ok(res, { version: await getConsentVersion() })),
};

// ---------------- dashboard ----------------
export const dashboard = {
  personal: h(async (req, res) => ok(res, await dashboardService.personalDashboard(req.auth, req.validatedQuery))),
  staff: h(async (req, res) => ok(res, await dashboardService.staffDashboard(req.auth, req.validatedQuery))),
  admin: h(async (req, res) => ok(res, await dashboardService.adminDashboard(req.validatedQuery))),
};

// ---------------- activity tracking (anonymous) ----------------
export const activity = {
  track: h(async (req, res) => {
    let vid = req.cookies?.ec_vid;
    if (!vid || !/^[0-9a-f-]{36}$/.test(vid)) {
      vid = crypto.randomUUID();
      res.cookie('ec_vid', vid, { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure, maxAge: 365 * 864e5, path: '/' });
    }
    await adminService.trackEvent(vid, req.body.event, req.body.path, req.auth?.userId);
    res.status(204).end();
  }),
};

// ---------------- admin ----------------
export const admin = {
  statistics: h(async (req, res) => ok(res, await adminService.statistics(req.validatedQuery))),
  health: h(async (req, res) => ok(res, await adminService.systemHealth({ fresh: req.query.fresh === '1' }))),
  users: h(async (req, res) => ok(res, await adminService.listUsers(req.validatedQuery))),
  user: h(async (req, res) => ok(res, await adminService.getUser(req.params.id))),
  userStatus: h(async (req, res) => ok(res, await adminService.setUserStatus(req.auth, req.params.id, req.body.status, req.body.reason))),
  userRole: h(async (req, res) => ok(res, await adminService.setUserRole(req.auth, req.params.id, req.body.role))),
  activity: h(async (req, res) => ok(res, await adminService.listActivity(req.validatedQuery))),
  screenings: h(async (req, res) => ok(res, await adminService.listAllScreenings(req.validatedQuery))),
  screening: h(async (req, res) => ok(res, await adminService.getScreeningForAdmin(req.auth, req.params.id))),
  codes: h(async (req, res) => ok(res, await adminService.listRegistrationCodes({ q: req.query.q }))),
  codeCapabilities: h(async (req, res) => ok(res, await adminService.registrationCodeCapabilities())),
  newCode: h(async (req, res) => ok(res, adminService.newRegistrationCodePreview())),
  revealCode: h(async (req, res) => ok(res, await adminService.revealRegistrationCode(req.auth, req.params.id))),
  createCode: h(async (req, res) => ok(res, await adminService.createRegistrationCode(req.auth, req.body), 201)),
  code: h(async (req, res) => ok(res, await adminService.getRegistrationCode(req.params.id))),
  updateCode: h(async (req, res) => ok(res, await adminService.updateRegistrationCode(req.auth, req.params.id, req.body))),
  deleteCode: h(async (req, res) => ok(res, await adminService.deleteRegistrationCode(req.auth, req.params.id))),
  settings: h(async (req, res) => ok(res, await adminService.getSettings())),
  updateSettings: h(async (req, res) => ok(res, await adminService.updateSettings(req.auth, req.body))),
};

export const datasets = {
  list: h(async (req, res) => ok(res, await datasetService.listDataset(req.validatedQuery))),
  summary: h(async (req, res) => ok(res, await datasetService.datasetSummary())),
  get: h(async (req, res) => ok(res, await datasetService.getDatasetItem(req.params.id))),
  create: h(async (req, res) => ok(res, await datasetService.addDatasetImage(req.auth, req.file, req.body.suggested_class), 201)),
  update: h(async (req, res) => ok(res, await datasetService.updateClass(req.auth, req.params.id, req.body.disease_class))),
  remove: h(async (req, res) => ok(res, await datasetService.removeItem(req.auth, req.params.id))),
  approve: h(async (req, res) => ok(res, await datasetService.approve(req.auth, req.params.id, req.body.disease_class))),
  reject: h(async (req, res) => ok(res, await datasetService.reject(req.auth, req.params.id, req.body.reason))),
  sendToRoboflow: h(async (req, res) => ok(res, await datasetService.sendToRoboflow(req.auth, req.params.id))),
};

export const roboflowAdmin = {
  status: h(async (req, res) => {
    const s = await rfAdmin.status();
    ok(res, { ...s, project_url: rfAdmin.projectUrl(s.active) });
  }),
  workspaces: h(async (req, res) => ok(res, await rfAdmin.workspaces())),
  projects: h(async (req, res) => ok(res, await rfAdmin.projects())),
  datasets: h(async (req, res) => ok(res, await rfAdmin.versions(req.query.project))),
  models: h(async (req, res) => ok(res, await rfAdmin.versions(req.query.project))),
  version: h(async (req, res) => ok(res, await rfAdmin.versionDetail(req.params.version))),
  setActive: h(async (req, res) => {
    const m = await rfAdmin.setActiveModel(req.auth, req.body);
    ok(res, { project: m.project, version: m.version, classes: m.capabilities.classes, supported: m.capabilities.supported });
  }),
  images: h(async (req, res) => ok(res, await rfAdmin.searchImages(req.validatedQuery))),
  image: h(async (req, res) => ok(res, await rfAdmin.imageDetail(req.params.id))),
  deleteImage: h(async (req, res) => ok(res, await rfAdmin.deleteImage(req.auth, req.params.id))),
  upload: h(async (req, res) => {
    if (!req.file) throw new AppError(422, 'IMAGE_REQUIRED', 'กรุณาเลือกไฟล์ภาพ');
    ok(res, await rfAdmin.uploadImage(req.auth, req.file, { split: req.body.split, tag: req.body.tag }), 201);
  }),
  generate: h(async (req, res) => ok(res, await rfAdmin.generateVersion(req.auth, req.body), 201)),
  train: h(async (req, res) => ok(res, await rfAdmin.startTraining(req.auth, req.body))),
};
