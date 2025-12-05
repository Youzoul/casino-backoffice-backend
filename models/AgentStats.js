const mongoose = require('mongoose');

const agentStatsSchema = new mongoose.Schema({
  agent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true
  },
  totalMembers: { type: Number, default: 0, min: 0 },
  activeMembers: { type: Number, default: 0, min: 0 },
  totalCredit: { type: Number, default: 0, min: 0, set: v => Math.round(v * 100) / 100 },
  totalProfit: { type: Number, default: 0, min: 0, set: v => Math.round(v * 100) / 100 },
  commissionRate: { 
    type: Number, 
    default: 0.05,
    min: 0,
    max: 0.2,
    set: v => Math.round(v * 100) / 100
  },
  totalCommission: { type: Number, default: 0, min: 0, set: v => Math.round(v * 100) / 100 },
  commissionHistory: [{
    amount: { type: Number, required: true, set: v => Math.round(v * 100) / 100 },
    date: { type: Date, default: Date.now },
    description: { type: String, trim: true, maxlength: 255 }
  }],
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true
});

agentStatsSchema.index({ agent: 1 });
agentStatsSchema.index({ lastUpdated: -1 });

module.exports = mongoose.model('AgentStats', agentStatsSchema);