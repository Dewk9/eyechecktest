import { Router } from 'express';
import * as c from '../controllers/index.js';
import * as s from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { singleImage } from '../middleware/upload.js';
import { uuidParams } from './params.js';

const r = Router();
// Every admin endpoint requires an authenticated, active administrator.
r.use(requireAuth, requireAdmin);
uuidParams(r, 'id');

// ---- Overview / statistics
r.get('/statistics', validate(s.statsQuery, 'query'), c.admin.statistics);
r.get('/health', c.admin.health);
r.get('/dashboard', validate(s.dashboardQuery, 'query'), c.dashboard.admin);

// ---- Users
r.get('/users', validate(s.adminUsersQuery, 'query'), c.admin.users);
r.get('/users/:id', c.admin.user);
r.patch('/users/:id/status', validate(s.userStatusSchema), c.admin.userStatus);
r.patch('/users/:id/role', validate(s.userRoleSchema), c.admin.userRole);

// ---- Activity
r.get('/activity', validate(s.activityQuery, 'query'), c.admin.activity);

// ---- Screenings
r.get('/screenings', validate(s.screeningListQuery, 'query'), c.admin.screenings);
r.get('/screenings/:id', c.admin.screening);

// ---- Staff registration codes
r.get('/registration-codes', validate(s.regCodeListQuery, 'query'), c.admin.codes); // ?q= unit name or code
r.get('/registration-codes/capabilities', c.admin.codeCapabilities);
r.get('/registration-codes/new-code', c.admin.newCode); // system-generated code preview for the create dialog
r.post('/registration-codes', validate(s.regCodeSchema), c.admin.createCode);
r.get('/registration-codes/:id', c.admin.code);
r.get('/registration-codes/:id/reveal', c.admin.revealCode); // decrypt (admin only, logged)
r.patch('/registration-codes/:id', validate(s.regCodeUpdateSchema), c.admin.updateCode);
r.delete('/registration-codes/:id', c.admin.deleteCode);

// ---- Settings
r.get('/settings', c.admin.settings);
r.put('/settings', validate(s.settingsSchema), c.admin.updateSettings);

// ---- Roboflow
r.get('/roboflow/status', c.roboflowAdmin.status);
r.get('/roboflow/workspaces', c.roboflowAdmin.workspaces);
r.get('/roboflow/projects', c.roboflowAdmin.projects);
r.get('/roboflow/datasets', c.roboflowAdmin.datasets);
r.get('/roboflow/models', c.roboflowAdmin.models);
r.get('/roboflow/versions/:version', c.roboflowAdmin.version);
r.put('/roboflow/active-model', validate(s.activeModelSchema), c.roboflowAdmin.setActive);
r.get('/roboflow/images', validate(s.roboflowImagesQuery, 'query'), c.roboflowAdmin.images);
r.get('/roboflow/images/:imageId', (req, res, next) => { req.params.id = req.params.imageId; next(); }, c.roboflowAdmin.image);
r.delete('/roboflow/images/:imageId', (req, res, next) => { req.params.id = req.params.imageId; next(); }, c.roboflowAdmin.deleteImage);
r.post('/roboflow/upload', singleImage, c.roboflowAdmin.upload);
r.post('/roboflow/generate-version', validate(s.roboflowGenerateSchema), c.roboflowAdmin.generate);
r.post('/roboflow/train', validate(s.roboflowTrainSchema), c.roboflowAdmin.train);

// ---- Local dataset (consented images) + review workflow
r.get('/datasets', validate(s.datasetListQuery, 'query'), c.datasets.list);
r.get('/datasets/summary', c.datasets.summary);
r.post('/datasets', singleImage, validate(s.datasetCreateSchema), c.datasets.create);
r.get('/datasets/:id', c.datasets.get);
r.put('/datasets/:id', validate(s.datasetUpdateSchema), c.datasets.update);
r.delete('/datasets/:id', c.datasets.remove);
r.post('/datasets/:id/approve', validate(s.datasetApproveSchema), c.datasets.approve);
r.post('/datasets/:id/reject', validate(s.datasetRejectSchema), c.datasets.reject);
r.post('/datasets/:id/send-to-roboflow', c.datasets.sendToRoboflow);

export default r;
