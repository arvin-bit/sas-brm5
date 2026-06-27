import webpush from 'web-push';

let subs = [];

webpush.setVapidDetails(
  'mailto:alvindandme@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { title, body, url } = req.body;

  for (const sub of subs) {
    webpush.sendNotification(
      sub,
      JSON.stringify({ title, body, url })
    ).catch(err => console.log('Push error:', err));
  }

  res.json({ sent: true });
}
