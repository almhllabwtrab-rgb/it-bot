/**
 * بوت اللجنة العلمية لقسم تقنية المعلومات 🎓
 * النسخة الكاملة والمستقرة نهائياً (مع حماية الأخطاء الشاملة)
 */
import fs from 'node:fs';
import http from 'node:http';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9071549744:AAEkqQHDbJXoUIoRtvDmx5kojnze2zCaJZo';
const ADMIN_IDS = ['5748925491', '7197527939']; // قائمة أرقام المشرفين

const DATA_FILE = './submissions-backup.json';
const SLA_MINUTES = 15;

if (!TOKEN) {
  console.error('خطأ: يرجى ضبط التوكن الخاص بالبوت.');
  process.exit(1);
}

// حماية السيرفر من الانهيار بسبب أخطاء غير معالجة
process.on('uncaughtException', (err) => {
  console.error('⚠️ خطأ غير معالج (Uncaught Exception):', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ رفض وعد غير معالج (Unhandled Rejection):', reason);
});

// خادم ويب مصغر لمنع الاستضافة من إيقاف البوت
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 بوت اللجنة العلمية لقسم تقنية المعلومات يعمل بكفاءة تامة!');
}).listen(PORT, () => {
  console.log(`🌐 خادم الويب يعمل على المنفذ ${PORT} لإبقاء البوت نشطاً.`);
});

const API = `https://api.telegram.org/bot${TOKEN}`;

// هيكل البيانات المخزن
let state = { nextSeq: 1001, busyMode: false, submissions: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
    if (fileContent.trim()) {
      state = JSON.parse(fileContent);
    }
  }
} catch (e) {
  console.error('⚠️ تحذير: لم يتم قراءة ملف النسخة الاحتياطية بشكل صحيح، جاري البدء ببيانات جديدة.');
}

// تخزين مؤقت لجلسات الطلاب أثناء اختيار النوع والمقرر
const studentSessions = {};

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('خطأ أثناء حفظ البيانات:', e.message);
  }
}

async function tg(method, body) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error(`Telegram API Error [${method}]:`, json.description);
      return null;
    }
    return json.result;
  } catch (err) {
    console.error(`Network Error [${method}]:`, err.message);
    return null;
  }
}

const WELCOME_MSG = "أهلاً بك في بوت اللجنة العلمية لقسم تقنية المعلومات 🎓\n\nيمكنك إرسال الملخصات، ملفات PDF، العروض التقديمية، أو الاستفسارات الدراسية مباشرة هنا.\nبمجرد إرسالك لأي ملف، سيطلب منك البوت تحديد نوعه ومقرره بدقة لسهولة الأرشفة.";

// لوحة مفاتيح أنواع المحتوى
function getTypeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📚 ملخص دراسي', callback_data: 'stype:ملخص' }],
      [{ text: '📝 نموذج / اختبار سابق', callback_data: 'stype:نموذج' }],
      [{ text: '🏛️ محاضرة / شريحة عرض', callback_data: 'stype:محاضرة' }],
      [{ text: '❓ استفسار عام / أخرى', callback_data: 'stype:أخرى' }]
    ]
  };
}

// لوحة مفاتيح المقررات الدراسية المحددة
function getCourseKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔌 تصميم منطقي', callback_data: 'scourse:تصميم منطقي' },
        { text: '💻 برمجة حاسوب 2', callback_data: 'scourse:برمجة حاسوب 2' }
      ],
      [
        { text: '📐 رياضيات 2 (التكامل)', callback_data: 'scourse:رياضيات 2 (التكامل)' },
        { text: '⚡ فيزياء عامة', callback_data: 'scourse:فيزياء عامة' }
      ],
      [
        { text: '🔤 مهارات اللغة الانجليزية', callback_data: 'scourse:مهارات اللغة الانجليزية' },
        { text: '✍️ مهارات اللغة العربية', callback_data: 'scourse:مهارات اللغة العربية' }
      ],
      [
        { text: '➕ اخرى (كتابة يدوية)', callback_data: 'scourse:manual' }
      ]
    ]
  };
}

// لوحة أزرار المشرفين (تأكيد + تصويت)
function getAdminKeyboard(sub) {
  const ackStatus = sub.acknowledged ? '✅ تم التأكيد' : '☑️ تأكيد الاستلام';
  const votes = sub.votes || {};
  const approveCount = Object.values(votes).filter(v => v === 'approve').length;
  const editCount = Object.values(votes).filter(v => v === 'edit').length;
  const rejectCount = Object.values(votes).filter(v => v === 'reject').length;

  return {
    inline_keyboard: [
      [{ text: `${ackStatus}`, callback_data: `ack:${sub.id}` }],
      [
        { text: `👍 اعتماد (${approveCount})`, callback_data: `vote:${sub.id}:approve` },
        { text: `🔄 تعديل (${editCount})`, callback_data: `vote:${sub.id}:edit` },
        { text: `❌ رفض (${rejectCount})`, callback_data: `vote:${sub.id}:reject` }
      ]
    ]
  };
}

// تنسيق رسالة المشرفين (بدون إظهار ID الطالب)
function formatSubmissionCaption(sub) {
  const votes = sub.votes || {};
  const votersList = Object.entries(votes).map(([id, v]) => {
    const vSymbol = v === 'approve' ? '👍 اعتماد' : v === 'edit' ? '🔄 تعديل' : '❌ رفض';
    return `• مشرف ${id.slice(-4)}: ${vSymbol}`;
  }).join('\n');

  let statusText = sub.acknowledged ? '✅ تم تأكيد استلامه' : '⏳ بانتظار المراجعة';
  if (sub.replied) statusText += ' | 💬 تم الرد';

  return `📥 ملف جديد [${sub.trackingCode}]\n` +
         `👤 الطالب: ${sub.studentName}\n` +
         `📂 نوع المحتوى: ${sub.contentType}\n` +
         `📚 المقرر: ${sub.courseName}\n` +
         `📎 الملف: ${sub.fileName}\n` +
         `📌 الحالة: ${statusText}\n\n` +
         (votersList ? `📊 أصوات المشرفين:\n${votersList}\n\n` : '') +
         `💬 للرد: اسحب هذه الرسالة (Reply) أو استخدم:\n/reply ${sub.trackingCode} [نص الرد]`;
}

async function updateAllAdminMessages(sub) {
  if (!sub.adminMessageIds) return;
  const caption = formatSubmissionCaption(sub);
  const keyboard = getAdminKeyboard(sub);

  for (const [adminId, msgId] of Object.entries(sub.adminMessageIds)) {
    try {
      await tg('editMessageCaption', {
        chat_id: adminId,
        message_id: msgId,
        caption: caption,
        reply_markup: keyboard,
      });
    } catch (e) {
      try {
        await tg('editMessageText', {
          chat_id: adminId,
          message_id: msgId,
          text: caption,
          reply_markup: keyboard,
        });
      } catch (err) {}
    }
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.from.id);
    const data = cq.data || '';

    if (ADMIN_IDS.includes(chatId)) {
      if (data.startsWith('ack:')) {
        const subId = data.slice(4);
        const sub = state.submissions.find((s) => s.id === subId);
        if (sub) {
          sub.acknowledged = true;
          saveState();
          await updateAllAdminMessages(sub);

          await tg('sendMessage', {
            chat_id: sub.studentChatId,
            text: `🔔 إشعار من اللجنة العلمية\n\nعزيزي الطالب، تم رسميّاً مراجعة وتأكيد استلام ملفك (${sub.contentType}) لمقرر ${sub.courseName} برقم التتبع (${sub.trackingCode}) بنجاح ✅.\nشكراً لجهودك ومساهمتك الأكاديمية!`,
          });

          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ تم تأكيد الاستلام وإشعار الطالب!' });
        }
        return;
      } else if (data.startsWith('vote:')) {
        const [, subId, voteType] = data.split(':');
        const sub = state.submissions.find((s) => s.id === subId);
        if (sub) {
          if (!sub.votes) sub.votes = {};
          sub.votes[chatId] = voteType;
          saveState();
          await updateAllAdminMessages(sub);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '🗳️ تم تسجيل صوتك بنجاح.' });
        }
        return;
      }
    }

    if (data.startsWith('stype:')) {
      const selectedType = data.slice(6);
      if (studentSessions[chatId]) {
        studentSessions[chatId].contentType = selectedType;
        studentSessions[chatId].step = 'COURSE';
        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          text: `✅ تم اختيار النوع: ${selectedType}\n\nالخطوة 2: يرجى اختيار اسم المقرر الدراسي:`,
          reply_markup: getCourseKeyboard()
        });
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return;
    }

    if (data.startsWith('scourse:')) {
      const selectedCourse = data.slice(8);
      const session = studentSessions[chatId];
      if (session) {
        if (selectedCourse === 'manual') {
          session.step = 'WAITING_MANUAL_COURSE';
          await tg('editMessageText', {
            chat_id: chatId,
            message_id: cq.message.message_id,
            text: `✍️ حسناً، يرجى كتابة اسم المقرر الدراسي في رسالة نصية الآن:`,
          });
        } else {
          session.courseName = selectedCourse;
          await finalizeSubmission(chatId, cq.message.message_id);
        }
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return;
    }

    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const studentName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'طالب';

  if (ADMIN_IDS.includes(chatId)) {
    const txt = (msg.text || '').trim();

    if (txt === '/start') {
      await tg('sendMessage', { 
        chat_id: chatId, 
        text: WELCOME_MSG + '\n\n🛠️ أوامر لوحة المشرفين:\n- /busy on أو /busy off للتحكم بوضع الانشغال.\n- /stats لعرض الإحصائيات.\n- /list لعرض الطلبات المعلقة.\n- للرد: استخدم الـ Reply أو /reply [رقم التتبع] [الرد].' 
      });
      return;
    }
    if (txt === '/busy on') {
      state.busyMode = true;
      saveState();
      await tg('sendMessage', { chat_id: chatId, text: '🔕 تم تفعيل وضع الانشغال للرد التلقائي.' });
      return;
    }
    if (txt === '/busy off') {
      state.busyMode = false;
      saveState();
      await tg('sendMessage', { chat_id: chatId, text: '🔔 تم إيقاف وضع الانشغال.' });
      return;
    }
    if (txt === '/stats') {
      const total = state.submissions.length;
      const ackCount = state.submissions.filter(s => s.acknowledged).length;
      const repliedCount = state.submissions.filter(s => s.replied).length;
      await tg('sendMessage', {
        chat_id: chatId,
        text: `📊 إحصائيات اللجنة العلمية:\n\n- إجمالي المشاركات: ${total}\n- تم تأكيدها: ${ackCount}\n- تم الرد عليها: ${repliedCount}\n- المعلقة: ${total - ackCount}`
      });
      return;
    }
    if (txt === '/list') {
      const pending = state.submissions.filter(s => !s.replied).slice(0, 5);
      if (pending.length === 0) {
        await tg('sendMessage', { chat_id: chatId, text: '🎉 رائع! لا توجد طلبات معلقة.' });
      } else {
        const listText = pending.map(s => `• ${s.trackingCode} - ${s.studentName} (${s.contentType} / ${s.courseName})`).join('\n');
        await tg('sendMessage', { chat_id: chatId, text: `📋 آخر الطلبات غير المردود عليها:\n\n${listText}` });
      }
      return;
    }

    let target = null;
    let replyBody = txt;
    const match = /^\/reply\s+(IT-\d+)\s+([\s\S]+)$/i.exec(txt);
    if (match) {
      target = state.submissions.find((s) => s.trackingCode === match[1].toUpperCase());
      replyBody = match[2];
    } else if (msg.reply_to_message) {
      target = state.submissions.find(
        (s) => s.adminMessageIds && Object.values(s.adminMessageIds).includes(msg.reply_to_message.message_id)
      );
    }

    if (target) {
      await tg('sendMessage', {
        chat_id: target.studentChatId,
        text: `📩 رد من اللجنة العلمية بخصوص طلبك (${target.trackingCode}):\n\n${replyBody}`,
      });
      target.acknowledged = true;
      target.replied = true;
      saveState();
      await updateAllAdminMessages(target);

      const adminNotice = `💬 تنبيه إداري: المشرف (${chatId.slice(-4)}) رد على الطالب (${target.trackingCode}):\n\n> ${replyBody}`;
      for (const adminId of ADMIN_IDS) {
        if (adminId !== chatId) {
          await tg('sendMessage', { chat_id: adminId, text: adminNotice });
        }
      }

      await tg('sendMessage', { chat_id: chatId, text: `✅ تم إرسال الرد للطالب بنجاح.` });
    } else if (txt.startsWith('/reply')) {
      await tg('sendMessage', { chat_id: chatId, text: '❌ لم يتم العثور على رقم التتبع المحدد، تأكد من كتابته بالشكل الصحيح (مثال: IT-1001).' });
    }
    return;
  }

  if (msg.text === '/start') {
    await tg('sendMessage', { chat_id: chatId, text: WELCOME_MSG });
    return;
  }

  if (studentSessions[chatId] && studentSessions[chatId].step === 'WAITING_MANUAL_COURSE') {
    studentSessions[chatId].courseName = msg.text.trim();
    await finalizeSubmission(chatId, null);
    return;
  }

  if (msg.document || msg.photo || msg.text) {
    const fileName = msg.document?.file_name || (msg.photo ? 'صورة_مشاركة.jpg' : 'رسالة_نصية');
    
    studentSessions[chatId] = {
      msg: msg,
      studentName: studentName,
      fileName: fileName,
      contentType: null,
      courseName: null,
      step: 'TYPE'
    };

    await tg('sendMessage', {
      chat_id: chatId,
      text: `📥 تم استلام الملف بنجاح يا ${studentName} ✅\n\nالخطوة 1: يرجى تحديد نوع المحتوى من القائمة أدناه:`,
      reply_markup: getTypeKeyboard()
    });
  }
}

async function finalizeSubmission(chatId, editMessageId) {
  const session = studentSessions[chatId];
  if (!session) return;

  const trackingCode = `IT-${state.nextSeq++}`;
  const record = {
    id: String(Date.now()),
    trackingCode,
    studentChatId: chatId,
    studentName: session.studentName,
    fileName: session.fileName,
    contentType: session.contentType || 'ملخص',
    courseName: session.courseName || 'عام',
    acknowledged: false,
    replied: false,
    adminMessageIds: {},
    votes: {},
    createdAt: Date.now(),
    escalated: false,
  };

  state.submissions.unshift(record);
  saveState();

  const successText = `✨ تم حفظ مشاركتك بنجاح تام!\n\n📋 تفاصيل المشاركة:\n- رقم التتبع: ${trackingCode}\n- النوع: ${record.contentType}\n- المقرر: ${record.courseName}\n- الملف: ${record.fileName}\n\nتم تحويل الملف إلى اللجنة العلمية للمراجعة.`;
  
  if (editMessageId) {
    const edited = await tg('editMessageText', {
      chat_id: chatId,
      message_id: editMessageId,
      text: successText,
    });
    if (!edited) {
      await tg('sendMessage', { chat_id: chatId, text: successText });
    }
  } else {
    await tg('sendMessage', { chat_id: chatId, text: successText });
  }

  if (ADMIN_IDS.length > 0) {
    const caption = formatSubmissionCaption(record);
    const replyMarkup = getAdminKeyboard(record);
    const msg = session.msg;

    for (const adminId of ADMIN_IDS) {
      try {
        let sentMsg;
        if (msg.document) {
          sentMsg = await tg('sendDocument', {
            chat_id: adminId,
            document: msg.document.file_id,
            caption: caption,
            reply_markup: replyMarkup,
          });
        } else if (msg.photo) {
          const photoId = msg.photo[msg.photo.length - 1].file_id;
          sentMsg = await tg('sendPhoto', {
            chat_id: adminId,
            photo: photoId,
            caption: caption,
            reply_markup: replyMarkup,
          });
        } else {
          sentMsg = await tg('sendMessage', {
            chat_id: adminId,
            text: `${caption}\n\n📝 النص المرسل:\n${msg.text || ''}`,
            reply_markup: replyMarkup,
          });
        }
        if (sentMsg) {
          record.adminMessageIds[adminId] = sentMsg.message_id;
        }
      } catch (e) {
        console.error(`فشل إرسال الملف للمشرف ${adminId}:`, e.message);
      }
    }
    saveState();
  }

  delete studentSessions[chatId];
}

// مؤلف التنبيهات (SLA)
setInterval(async () => {
  if (ADMIN_IDS.length === 0) return;

  const now = Date.now();
  for (const sub of state.submissions) {
    if (!sub.acknowledged && !sub.escalated && now - sub.createdAt >= SLA_MINUTES * 60_000) {
      sub.escalated = true;
      saveState();
      for (const adminId of ADMIN_IDS) {
        await tg('sendMessage', {
          chat_id: adminId,
          text: `🚨 تنبيه عاجل: المشاركة ${sub.trackingCode} (${sub.contentType} - ${sub.courseName}) لم يتم تأكيد استلامها منذ ${SLA_MINUTES} دقيقة!`,
        });
      }
    }
  }
}, 30_000);

// بدء التشغيل وحلقة الاستطلاع
try {
  await tg('deleteWebhook', { drop_pending_updates: true });
  console.log('🧹 تم تنظيف الروابط وتفعيل وضع التشغيل بنجاح.');
} catch (e) {}

let offset = 0;
console.log('🚀 بوت اللجنة العلمية يعمل الآن بدون أخطاء وبكفاءة تامة...');

while (true) {
  try {
    const updates = await tg('getUpdates', { offset, timeout: 25 });
    if (updates && Array.isArray(updates)) {
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    }
  } catch (err) {
    console.error('Polling error:', err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
