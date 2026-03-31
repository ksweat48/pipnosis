import { schedule } from '@netlify/functions';

export const handler = schedule('0 2 * * *', async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'scheduled-refresh: no-op' }),
  };
});
