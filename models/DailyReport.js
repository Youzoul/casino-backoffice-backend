const mongoose = require('mongoose');

const dailyReportSchema = new mongoose.Schema({
  date: { 
    type: Date, 
    required: true, 
    unique: true 
  },
  totalMembers: { type: Number, default: 0, min: 0 },
  activeMembers: { type: Number, default: 0, min: 0 },
  totalCreditMovement: { type: Number, default: 0, min: 0, set: v => Math.round(v * 100) / 100 },
  totalCommission: { type: Number, default: 0, min: 0, set: v => Math.round(v * 100) / 100 },
  agentReports: [{
    agent: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    members: { type: Number, default: 0 },
    creditMovement: { type: Number, default: 0, set: v => Math.round(v * 100) / 100 },
    commission: { type: Number, default: 0, set: v => Math.round(v * 100) / 100 }
  }],
  systemNotes: { type: String, maxlength: 1000 }
}, {
  timestamps: true
});

dailyReportSchema.index({ date: 1 });
dailyReportSchema.index({ createdAt: -1 });

dailyReportSchema.virtual('formattedDate').get(function() {
  return new Date(this.date).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

module.exports = mongoose.model('DailyReport', dailyReportSchema);