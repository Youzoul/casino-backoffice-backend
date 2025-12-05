const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');

const router = express.Router();

const validateRegistration = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4, max: 30 }).withMessage('Username must be between 4 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('password')
    .trim()
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('role')
    .optional()
    .isIn(['superadmin', 'agent', 'member']).withMessage('Invalid role'),
  body('agentCode')
    .optional()
    .trim()
    .isLength({ min: 4, max: 10 }).withMessage('Agent code must be between 4 and 10 characters')
];

const validateLogin = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required'),
  body('password')
    .trim()
    .notEmpty().withMessage('Password is required')
];

router.post('/register', validateRegistration, async (req, res) => {
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
    const { username, password, role, agentCode } = req.body;
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    let parent = null;
    if (agentCode) {
      const agent = await User.findOne({ 
        agentCode, 
        role: 'agent' 
      });
      
      if (!agent) {
        return res.status(400).json({ error: 'Invalid agent code' });
      }
      parent = agent._id;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      password: hashedPassword,
      role: role || (parent ? 'member' : 'superadmin'),
      parent,
      agentCode: role === 'agent' ? agentCode || `AGENT${Date.now().toString().slice(-6)}` : undefined
    });

    await newUser.save();
    
    if (newUser.role === 'agent') {
      const AgentStats = require('../models/AgentStats');
      await new AgentStats({ agent: newUser._id }).save();
    }

    const token = jwt.sign(
      { id: newUser._id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({ 
      message: 'User created successfully',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        role: newUser.role,
        agentCode: newUser.agentCode
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Duplicate key error - username or agent code already exists' });
    }
    
    res.status(500).json({ 
      error: 'Server error during registration',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.post('/login', validateLogin, async (req, res) => {
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
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { 
        id: user._id, 
        username: user.username, 
        role: user.role,
        credit: user.credit,
        agentCode: user.agentCode
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

module.exports = router;