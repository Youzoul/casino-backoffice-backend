const DailyReport = require('../models/DailyReport');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const AgentStats = require('../models/AgentStats');
const { calculateCommission } = require('./commissionService');
const cron = require('node-cron');
const mongoose = require('mongoose');

cron.schedule('0 0 * * *', async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    console.log(`📊 Generating daily report for ${yesterday.toDateString()}`);
    
    const transactions = await Transaction.find({
      createdAt: { $gte: yesterday, $lt: today }
    });
    
    const agents = await User.find({ role: 'agent' });
    
    const totalCreditMovement = transactions.reduce((sum, t) => sum + t.amount, 0);
    
    const agentReports = [];
    for (const agent of agents) {
      const memberIds = await User.find({ parent: agent._id, role: 'member' }).distinct('_id');
      
      const memberTransactions = transactions.filter(t => memberIds.includes(t.user.toString()));
      
      const creditMovement = memberTransactions.reduce((sum, t) => sum + t.amount, 0);
      
      const commission = creditMovement * 0.01;
      
      agentReports.push({
        agent: agent._id,
        members: memberIds.length,
        creditMovement,
        commission
      });
      
      await AgentStats.findOneAndUpdate(
        { agent: agent._id },
        { 
          $inc: { totalCommission: commission },
          $set: { lastUpdated: new Date() }
        },
        { upsert: true, new: true }
      );
    }
    
    const totalMembers = await User.countDocuments({ role: 'member' });
    const activeMembers = await User.countDocuments({ role: 'member', credit: { $gt: 0 } });
    const totalCommission = agentReports.reduce((sum, r) => sum + r.commission, 0);
    
    const report = await DailyReport.findOneAndUpdate(
      { date: yesterday },
      {
        totalMembers,
        activeMembers,
        totalCreditMovement,
        totalCommission,
        agentReports,
        systemNotes: `Auto-generated report by system at ${new Date().toISOString()}`
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    
    console.log('✅ Daily report generated successfully');
    return report;
  } catch (err) {
    console.error('❌ Daily report generation failed:', err);
    throw err;
  }
});

const generateReport = async (startDate, endDate) => {
  try {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    const reports = await DailyReport.find({
      date: { $gte: start, $lte: end }
    }).sort({ date: 1 });
    
    const agents = await User.find({ role: 'agent' }, 'username');
    const agentMap = {};
    agents.forEach(agent => {
      agentMap[agent._id.toString()] = agent.username;
    });
    
    const formattedReports = reports.map(report => {
      const agentReports = report.agentReports.map(ar => ({
        ...ar,
        agentName: agentMap[ar.agent.toString()] || 'Unknown Agent'
      }));
      
      return {
        ...report.toObject(),
        formattedDate: report.formattedDate,
        agentReports
      };
    });
    
    return formattedReports;
  } catch (err) {
    console.error('Error generating report:', err);
    throw err;
  }
};

const generateWeeklySummary = async (year, weekNumber) => {
  try {
    const firstDay = new Date(year, 0, 1 + (weekNumber - 1) * 7);
    firstDay.setDate(firstDay.getDate() - firstDay.getDay() + 1);
    
    const lastDay = new Date(firstDay);
    lastDay.setDate(lastDay.getDate() + 6);
    
    const reports = await DailyReport.find({
      date: { $gte: firstDay, $lte: lastDay }
    }).sort({ date: 1 });
    
    if (reports.length === 0) {
      return {
        weekNumber,
        year,
        startDate: firstDay.toISOString().split('T')[0],
        endDate: lastDay.toISOString().split('T')[0],
        totalReports: 0,
        summary: null
      };
    }
    
    const totalCreditMovement = reports.reduce((sum, r) => sum + r.totalCreditMovement, 0);
    const totalCommission = reports.reduce((sum, r) => sum + r.totalCommission, 0);
    const avgMembers = reports.reduce((sum, r) => sum + r.totalMembers, 0) / reports.length;
    const avgActiveMembers = reports.reduce((sum, r) => sum + r.activeMembers, 0) / reports.length;
    
    return {
      weekNumber,
      year,
      startDate: firstDay.toISOString().split('T')[0],
      endDate: lastDay.toISOString().split('T')[0],
      totalReports: reports.length,
      summary: {
        totalCreditMovement: Math.round(totalCreditMovement * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        avgMembers: Math.round(avgMembers),
        avgActiveMembers: Math.round(avgActiveMembers),
        dailyReports: reports.map(r => ({
          date: r.date.toISOString().split('T')[0],
          totalCreditMovement: r.totalCreditMovement,
          totalCommission: r.totalCommission,
          totalMembers: r.totalMembers
        }))
      }
    };
  } catch (err) {
    console.error('Error generating weekly summary:', err);
    throw err;
  }
};

module.exports = {
  generateReport,
  generateWeeklySummary
};