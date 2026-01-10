import mongoose from 'mongoose';

const ehrRecordSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recordName: {
        type: String,
        required: true,
        trim: true
    },
    recordType: {
        type: String,
        enum: ['Report', 'Prescription', 'Lab Result', 'Other'],
        default: 'Report'
    },
    fileUrl: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    notes: String
}, { timestamps: true });

export default mongoose.model('EHRRecord', ehrRecordSchema);
