import express from 'express';
import { getEHRRecords, uploadEHRRecord, deleteEHRRecord } from '../controllers/ehrController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getEHRRecords)
    .post(uploadEHRRecord);

router.delete('/:id', deleteEHRRecord);

export default router;
