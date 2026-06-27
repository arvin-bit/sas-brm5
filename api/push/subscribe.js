import webpush from 'web-push';

let subs = [];

webpush.setVapidDetails(
  'mailto:admin@Task Force Orion-sog.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  subs.push(req.body);
  res.json({ ok: true });
}
