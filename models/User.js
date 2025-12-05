const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    minlength: 4,
    maxlength: 30
  },
  password: { 
    type: String, 
    required: true,
    minlength: 6
  },
  role: { 
    type: String, 
    enum: ['superadmin', 'agent', 'member'], 
    default: 'member'
  },
  credit: { 
    type: Number, 
    default: 0,
    min: 0,
    set: v => Math.round(v * 100) / 100
  },
  parent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  agentCode: { 
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    minlength: 4,
    maxlength: 10
  }
}, {
  timestamps: true
});

userSchema.index({ parent: 1 });
userSchema.index({ agentCode: 1, role: 1 });
userSchema.index({ username: 1 }, { unique: true });

userSchema.methods.updateCredit = async function(amount, type, adjustedBy, description = 'Credit adjustment') {
  const oldCredit = this.credit;
  
  if (type === 'add') {
    this.credit += amount;
  } else if (type === 'deduct') {
    if (this.credit < amount) {
      throw new Error('Insufficient credit');
    }
    this.credit -= amount;
  } else {
    throw new Error('Invalid credit type');
  }
  
  await this.save();
  
  const Transaction = mongoose.model('Transaction');
  const transaction = new Transaction({
    user: this._id,
    amount,
    type,
    oldCredit,
    newCredit: this.credit,
    adjustedBy,
    description
  });
  
  await transaction.save();
  
  return {
    success: true,
    member: this,
    transaction
  };
};

module.exports = mongoose.model('User', userSchema);