const AgentStats = require('../models/AgentStats');
const User = require('../models/User');

const calculateCommission = async (agentId, betAmount, description = 'Commission from bet') => {
  try {
    const agentStats = await AgentStats.findOne({ agent: agentId }).populate('agent');
    if (!agentStats || !agentStats.agent) {
      console.log('Agent stats not found for agent ID:', agentId);
      return 0;
    }
    
    const commission = betAmount * agentStats.commissionRate;
    
    if (commission <= 0) {
      return 0;
    }
    
    const agent = agentStats.agent;
    agent.credit += commission;
    await agent.save();
    
    agentStats.totalCommission += commission;
    agentStats.commissionHistory.push({
      amount: commission,
      date: new Date(),
      description: `${description}: ${betAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
    });
    await agentStats.save();
    
    console.log(`✅ Commission calculated: ${commission.toLocaleString('th-TH', { minimumFractionDigits: 2 })} for agent ${agent.username}`);
    return commission;
  } catch (err) {
    console.error('❌ Commission calculation error:', err);
    return 0;
  }
};

const updateAgentStats = async (agentId) => {
  try {
    const agentStats = await AgentStats.findOne({ agent: agentId });
    if (!agentStats) return;
    
    const memberCount = await User.countDocuments({ parent: agentId, role: 'member' });
    const activeMemberCount = await User.countDocuments({ parent: agentId, role: 'member', credit: { $gt: 0 } });
    
    const totalCreditResult = await User.aggregate([
      { $match: { parent: agentId, role: 'member' } },
      { $group: { _id: null, total: { $sum: '$credit' } } }
    ]);
    
    const totalCredit = totalCreditResult[0]?.total || 0;
    
    agentStats.totalMembers = memberCount;
    agentStats.activeMembers = activeMemberCount;
    agentStats.totalCredit = totalCredit;
    agentStats.lastUpdated = new Date();
    
    await agentStats.save();
  } catch (err) {
    console.error('❌ Agent stats update error:', err);
  }
};

module.exports = { calculateCommission, updateAgentStats };