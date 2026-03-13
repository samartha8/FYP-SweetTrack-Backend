import express from 'express';
import { getHealthRecords, uploadHealthRecord, deleteHealthRecord } from '../controllers/recordController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getHealthRecords)
    .post(uploadHealthRecord);

router.delete('/:id', deleteHealthRecord);

export default router;
