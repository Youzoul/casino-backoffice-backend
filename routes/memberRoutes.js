const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const AgentStats = require('../models/AgentStats');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const { calculateCommission, updateAgentStats } = require('../services/commissionService');

const checkAccess = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    
    if (decoded.role === 'superadmin') {
      return next();
    }
    
    if (decoded.role === 'agent') {
      if (req.params.id) {
        User.findById(req.params.id)
          .then(member => {
            if (!member || member.parent?.toString() !== decoded.id) {
              return res.status(403).json({ error: 'Access denied to this member' });
            }
            next();
          })
          .catch(err => res.status(500).json({ error: 'Server error' }));
      } else {
        next();
      }
      return;
    }
    
    return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const validateCreditAdjustment = [
  param('id').isMongoId().withMessage('Invalid member ID'),
  body('amount')
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('Amount must be between 0.01 and 1,000,000')
    .custom(value => {
      const decimalPart = value.toString().split('.')[1];
      if (decimalPart && decimalPart.length > 2) {
        throw new Error('Amount must have at most 2 decimal places');
      }
      return true;
    }),
  body('type')
    .isIn(['add', 'deduct'])
    .withMessage('Type must be either "add" or "deduct"'),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string')
    .isLength({ max: 255 })
    .withMessage('Description must be less than 255 characters')
];

router.get('/', checkAccess, async (req, res) => {
  try {
    let members;
    
    if (req.user.role === 'superadmin') {
      members = await User.find({ 
        role: 'member',
        parent: { $exists: false } 
      }).select('-password -__v').sort({ createdAt: -1 });
    } else if (req.user.role === 'agent') {
      members = await User.find({ 
        parent: req.user.id,
        role: 'member'
      }).select('-password -__v').sort({ createdAt: -1 });
    }
    
    const formattedMembers = members.map(member => ({
      _id: member._id,
      username: member.username,
      role: member.role,
      credit: member.credit,
      createdAt: member.createdAt,
      parent: member.parent,
      formattedCredit: member.credit.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    }));
    
    res.json(formattedMembers);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'Server error while fetching members' });
  }
});

router.put('/:id/credit', checkAccess, validateCreditAdjustment, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }

  try {
    const { amount, type, description = 'Manual credit adjustment' } = req.body;
    const memberId = req.params.id;
    
    const member = await User.findById(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (req.user.role === 'agent' && (!member.parent || member.parent.toString() !== req.user.id)) {
      return res.status(403).json({ error: 'Access denied to this member' });
    }
    
    if (type === 'deduct' && member.credit < amount) {
      return res.status(400).json({ 
        error: `Insufficient credit. Current credit: ${member.credit.toFixed(2)}` 
      });
    }

    const result = await member.updateCredit(
      amount, 
      type, 
      req.user.id, 
      `${description} by ${req.user.username}`
    );
    
    if (member.parent && type === 'add') {
      await updateAgentStats(member.parent);
      await calculateCommission(
        member.parent, 
        amount * 0.01,
        `Manual credit adjustment for ${member.username}`
      );
    }

    res.json({
      success: true,
      member: {
        _id: result.member._id,
        username: result.member.username,
        credit: result.member.credit,
        role: result.member.role,
        formattedCredit: result.member.credit.toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      },
      transaction: {
        _id: result.transaction._id,
        amount: result.transaction.amount,
        type: result.transaction.type,
        timestamp: result.transaction.createdAt,
        formattedAmount: result.transaction.amount.toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      }
    });
  } catch (err) {
    console.error('Error updating credit:', err);
    
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid member ID format' });
    }
    
    if (err.message.includes('Insufficient credit')) {
      return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ 
      error: 'Server error while updating credit',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.get('/:id/transactions', checkAccess, async (req, res) => {
  try {
    const memberId = req.params.id;
    
    const member = await User.findById(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (req.user.role === 'agent' && member.parent?.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this member' });
    }

    const transactions = await Transaction.find({ user: memberId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-__v');

    const formattedTransactions = transactions.map(transaction => ({
      _id: transaction._id,
      amount: transaction.amount,
      type: transaction.type,
      oldCredit: transaction.oldCredit,
      newCredit: transaction.newCredit,
      description: transaction.description,
      createdAt: transaction.createdAt,
      formattedDate: transaction.formattedDate,
      formattedAmount: transaction.amount.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      formattedOldCredit: transaction.oldCredit.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      formattedNewCredit: transaction.newCredit.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    }));

    res.json({
      member: {
        _id: member._id,
        username: member.username,
        currentCredit: member.credit,
        formattedCurrentCredit: member.credit.toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      },
      transactions: formattedTransactions
    });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid member ID format' });
    }
    
    res.status(500).json({ 
      error: 'Server error while fetching transactions',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.get('/stats', checkAccess, async (req, res) => {
  try {
    let stats;
    
    if (req.user.role === 'superadmin') {
      const [totalMembers, activeMembers, totalCredit] = await Promise.all([
        User.countDocuments({ role: 'member', parent: { $exists: false } }),
        User.countDocuments({ role: 'member', parent: { $exists: false }, credit: { $gt: 0 } }),
        User.aggregate([
          { $match: { role: 'member', parent: { $exists: false } } },
          { $group: { _id: null, total: { $sum: '$credit' } } }
        ])
      ]);

      const totalCreditValue = totalCredit[0]?.total || 0;

      stats = {
        totalMembers,
        activeMembers,
        totalCredit: parseFloat(totalCreditValue.toFixed(2)),
        inactiveMembers: totalMembers - activeMembers,
        formattedTotalCredit: totalCreditValue.toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      };
    } else if (req.user.role === 'agent') {
      const agentStats = await AgentStats.findOne({ agent: req.user.id });
      stats = {
        totalMembers: agentStats?.totalMembers || 0,
        activeMembers: agentStats?.activeMembers || 0,
        totalCredit: agentStats?.totalCredit || 0,
        totalCommission: agentStats?.totalCommission || 0,
        commissionRate: agentStats?.commissionRate || 0.05,
        formattedTotalCredit: (agentStats?.totalCredit || 0).toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        formattedTotalCommission: (agentStats?.totalCommission || 0).toLocaleString('th-TH', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      };
    }
    
    res.json(stats || {});
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Server error while fetching statistics' });
  }
});

module.exports = {
  router,
  checkAccess
};