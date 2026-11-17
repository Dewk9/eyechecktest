import { Router } from 'express';
import * as c from '../controllers/index.js';
import * as s from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireAccountType } from '../middleware/auth.js';
import { authLimiter, analyzeLimiter, trackLimiter } from '../middleware/security.js';
import { singleImage } from '../middleware/upload.js';
import { uuidParams } from './params.js';

const r = Router();
uuidParams(r, 'id', 'patientId', 'screeningId');

// ---- Authentication
r.post('/auth/register', authLimiter, validate(s.registerSchema), c.auth.register);
r.post('/auth/login', authLimiter, validate(s.loginSchema), c.auth.login);
r.post('/auth/logout', c.auth.logout);
r.get('/auth/me', c.auth.me);
r.post('/auth/change-password', requireAuth, authLimiter, validate(s.changePasswordSchema), c.auth.changePassword);

// ---- Profiles
r.get('/profiles/me', requireAuth, c.profiles.me);
r.put('/profiles/me', requireAuth, validate(s.updateProfileSchema), c.profiles.update);
r.delete('/profiles/me', requireAuth, authLimiter, validate(s.deleteAccountSchema), c.profiles.remove);

// ---- Patients (staff only)
const staff = [requireAuth, requireAccountType('staff')];
r.get('/patients', ...staff, validate(s.listQuery, 'query'), c.patients.list);
r.post('/patients', ...staff, validate(s.patientSchema), c.patients.create);
r.get('/patients/:id', ...staff, c.patients.get);
r.put('/patients/:id', ...staff, validate(s.patientSchema), c.patients.update);
r.delete('/patients/:id', ...staff, c.patients.remove);

// ---- Medical history
r.post('/medical-history', requireAuth, validate(s.medicalHistorySchema), c.history.create);
r.get('/medical-history/me', requireAuth, requireAccountType('personal'), c.history.me);
r.get('/medical-history/record/:id', requireAuth, c.history.record);
r.get('/medical-history/:patientId', ...staff, c.history.byPatient);
r.put('/medical-history/:id', requireAuth, validate(s.medicalHistorySchema), c.history.update);

// ---- Vision tests
r.get('/vision-tests/criteria', c.vision.criteria);
r.post('/vision-tests', requireAuth, validate(s.visionTestSchema), c.vision.create);
r.get('/vision-tests', requireAuth, c.vision.list);
r.get('/vision-tests/screening/:screeningId', requireAuth, c.vision.byScreening);
r.get('/vision-tests/:id', requireAuth, c.vision.get);

// ---- Screenings
r.post('/screenings', requireAuth, analyzeLimiter, singleImage, validate(s.createScreeningSchema), c.screenings.create);
r.get('/screenings', requireAuth, validate(s.screeningListQuery, 'query'), c.screenings.list);
r.get('/screenings/:id', requireAuth, c.screenings.get);
r.delete('/screenings/:id', requireAuth, c.screenings.remove);

// ---- AI
r.post('/ai/analyze', requireAuth, analyzeLimiter, validate(s.analyzeSchema), c.ai.analyze);
r.get('/ai/status', c.ai.status);
r.get('/ai/models', requireAuth, c.ai.models);

// ---- Results
r.get('/results/:screeningId', requireAuth, c.screenings.result);
r.post('/results/:screeningId/save', requireAuth, c.screenings.save);

// ---- Consents (PDPA)
r.get('/consents/version', c.consents.version);
r.get('/consents', requireAuth, c.consents.list);
r.post('/consents/:id/withdraw', requireAuth, c.consents.withdraw);

// ---- Dashboards
r.get('/dashboard/personal', requireAuth, requireAccountType('personal'), validate(s.dashboardQuery, 'query'), c.dashboard.personal);
r.get('/dashboard/staff', ...staff, validate(s.dashboardQuery, 'query'), c.dashboard.staff);

// ---- Anonymous activity tracking
r.post('/activity/track', trackLimiter, validate(s.trackSchema), c.activity.track);

export default r;
