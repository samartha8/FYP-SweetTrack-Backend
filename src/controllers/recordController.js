import HealthRecord from '../models/Record.js';

// @desc    Get all health records for a user
// @route   GET /api/records
// @access  Private
export const getHealthRecords = async (req, res) => {
    try {
        const records = await HealthRecord.find({ user: req.user.id }).sort({ date: -1 });
        res.status(200).json({
            success: true,
            records
        });
    } catch (error) {
        console.error('Get Health Records error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching health records'
        });
    }
};

// @desc    Upload a new health record
// @route   POST /api/records
// @access  Private
export const uploadHealthRecord = async (req, res) => {
    try {
        const { recordName, recordType, fileUrl, notes } = req.body;

        if (!recordName || !fileUrl) {
            return res.status(400).json({
                success: false,
                message: 'Please provide record name and file URL'
            });
        }

        const record = await HealthRecord.create({
            user: req.user.id,
            recordName,
            recordType,
            fileUrl,
            notes
        });

        res.status(201).json({
            success: true,
            record
        });
    } catch (error) {
        console.error('Upload Health Record error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading health record'
        });
    }
};

// @desc    Delete a health record
// @route   DELETE /api/records/:id
// @access  Private
export const deleteHealthRecord = async (req, res) => {
    try {
        const record = await HealthRecord.findOneAndDelete({
            _id: req.params.id,
            user: req.user.id
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Record not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Record deleted successfully'
        });
    } catch (error) {
        console.error('Delete Health Record error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting health record'
        });
    }
};
