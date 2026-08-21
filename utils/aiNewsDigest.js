const triggerN8n = require('./triggerN8n');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');

const getStudentRecipients = async () => {
  const profiles = await StudentProfile.find({
    enrollmentStatus: { $in: ['pending', 'active'] },
  }).populate('user', 'name email isActive');

  return profiles
    .filter((p) => p.user?.email && p.user.isActive !== false)
    .map((p) => ({
      email: p.user.email,
      name: p.user.name,
    }));
};

const dispatchAiNews = async () => {
  const students = await getStudentRecipients();
  await triggerN8n('ai-news-digest', {
    students,
    studentCount: students.length,
  });
  return { studentCount: students.length };
};

const startAiNewsScheduler = () => {
  let lastRunDay = '';

  setInterval(async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hourCycle: 'h23',
      }).formatToParts(new Date());
      const get = (type) => parts.find((p) => p.type === type)?.value;
      const weekday = get('weekday');
      const hour = Number(get('hour'));
      const minute = Number(get('minute'));
      const dayKey = `${get('year')}-${get('month')}-${get('day')}`;

      if (weekday === 'Mon' && hour === 9 && minute < 5 && lastRunDay !== dayKey) {
        lastRunDay = dayKey;
        await dispatchAiNews();
        console.log(`AI news digest dispatched to n8n (${dayKey})`);
      }
    } catch (err) {
      console.error('AI news scheduler failed:', err.message);
    }
  }, 60 * 1000);
};

module.exports = { dispatchAiNews, getStudentRecipients, startAiNewsScheduler };
