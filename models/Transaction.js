const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true,
    min: 0.01,
    set: v => Math.round(v * 100) / 100
  },
  type: { 
    type: String, 
    enum: ['add', 'deduct'], 
    required: true 
  },
  oldCredit: { 
    type: Number, 
    required: true,
    set: v => Math.round(v * 100) / 100
  },
  newCredit: { 
    type: Number, 
    required: true,
    set: v => Math.round(v * 100) / 100
  },
  adjustedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  description: { 
    type: String,
    trim: true,
    default: 'Credit adjustment',
    maxlength: 255
  }
}, {
  timestamps: true
});

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });

transactionSchema.virtual('formattedDate').get(function() {
  return new Date(this.createdAt).toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
});

module.exports = mongoose.model('Transaction', transactionSchema);