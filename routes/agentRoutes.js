const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AgentStats = require('../models/AgentStats');
const { checkAccess } = require('./memberRoutes');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const validateAgentRegistration = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4, max: 30 }).withMessage('Username must be between 4 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('password')
    .trim()
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('agentCode')
    .optional()
    .trim()
    .isLength({ min: 4, max: 10 }).withMessage('Agent code must be between 4 and 10 characters')
    .matches(/^[A-Z0-9_]+$/).withMessage('Agent code can only contain uppercase letters, numbers, and underscores')
];

router.post('/register', checkAccess, validateAgentRegistration, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }

  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super Admin access only' });
  }

  try {
    const { username, password, agentCode } = req.body;
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const finalAgentCode = agentCode || `AGENT${Math.floor(100000 + Math.random() * 900000)}`;
    
    const existingAgent = await User.findOne({ agentCode: finalAgentCode });
    if (existingAgent) {
      return res.status(400).json({ error: 'Agent code already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newAgent = new User({
      username,
      password: hashedPassword,
      role: 'agent',
      parent: req.user.id,
      agentCode: finalAgentCode
    });

    await newAgent.save();
    
    await new AgentStats({ agent: newAgent._id }).save();

    res.status(201).json({ 
      message: 'Agent created successfully',
      agent: {
        id: newAgent._id,
        username: newAgent.username,
        agentCode: newAgent.agentCode,
        role: newAgent.role,
        formattedAgentCode: newAgent.agentCode
      }
    });
  } catch (err) {
    console.error('Agent registration error:', err);
    
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Duplicate key error - username or agent code already exists' });
    }
    
    res.status(500).json({ 
      error: 'Server error during agent registration',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.get('/my-members', checkAccess, async (req, res) => {
  if (req.user.role !== 'agent') {
    return res.status(403).json({ error: 'Agent access only' });
  }

  try {
    const members = await User.find({ 
      parent: req.user.id,
      role: 'member'
    }).select('-password -__v -parent').sort({ createdAt: -1 });
    
    const formattedMembers = members.map(member => ({
      _id: member._id,
      username: member.username,
      credit: member.credit,
      role: member.role,
      createdAt: member.createdAt,
      formattedCredit: member.credit.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    }));
    
    res.json(formattedMembers);
  } catch (err) {
    console.error('Error fetching agent members:', err);
    res.status(500).json({ error: 'Server error while fetching members' });
  }
});

router.get('/stats', checkAccess, async (req, res) => {
  if (req.user.role !== 'agent') {
    return res.status(403).json({ error: 'Agent access only' });
  }

  try {
    const stats = await AgentStats.findOne({ agent: req.user.id });
    
    if (!stats) {
      return res.status(404).json({ error: 'Agent statistics not found' });
    }
    
    res.json({
      totalMembers: stats.totalMembers,
      activeMembers: stats.activeMembers,
      totalCredit: stats.totalCredit,
      totalCommission: stats.totalCommission,
      commissionRate: stats.commissionRate,
      formattedTotalCredit: stats.totalCredit.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      formattedTotalCommission: stats.totalCommission.toLocaleString('th-TH', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      lastUpdated: stats.lastUpdated,
      formattedLastUpdated: new Date(stats.lastUpdated).toLocaleString('th-TH')
    });
  } catch (err) {
    console.error('Error fetching agent stats:', err);
    res.status(500).json({ error: 'Server error while fetching statistics' });
  }
});

router.get('/tree', checkAccess, async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super Admin access only' });
  }

  try {
    const superAdmin = await User.findById(req.user.id).select('username role agentCode');
    const agents = await User.find({ 
      role: 'agent',
      parent: req.user.id
    }).select('username role agentCode');

    const tree = {
      id: superAdmin._id,
      name: superAdmin.username,
      role: superAdmin.role,
      children: await Promise.all(agents.map(async (agent) => {
        const members = await User.find({
          parent: agent._id,
          role: 'member'
        }).select('username credit role');

        return {
          id: agent._id,
          name: agent.username,
          role: agent.role,
          agentCode: agent.agentCode,
          children: members.map(member => ({
            id: member._id,
            name: member.username,
            role: member.role,
            credit: member.credit,
            formattedCredit: member.credit.toLocaleString('th-TH', { 
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })
          }))
        };
      }))
    };

    res.json(tree);
  } catch (err) {
    console.error('Error fetching agent tree:', err);
    res.status(500).json({ error: 'Server error while fetching agent hierarchy' });
  }
});

module.exports = router;