import { Handler, schedule } from '@netlify/functions';

const handler: Handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'scheduled-refresh: no-op (refresh-service removed)' }),
  };
};

export { handler };
