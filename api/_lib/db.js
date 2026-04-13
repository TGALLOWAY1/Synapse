const API_VERSION = 'application/ejson';

function getConfig() {
  const url = process.env.MONGODB_DATA_API_URL;
  const apiKey = process.env.MONGODB_DATA_API_KEY;
  const dataSource = process.env.MONGODB_DATA_SOURCE;
  const database = process.env.MONGODB_DB_NAME || 'synapse';

  if (!url || !apiKey || !dataSource) {
    throw new Error('Missing MongoDB Data API config. Set MONGODB_DATA_API_URL, MONGODB_DATA_API_KEY, MONGODB_DATA_SOURCE.');
  }

  return { url, apiKey, dataSource, database };
}

export async function runMongoAction(action, payload) {
  const config = getConfig();
  const response = await fetch(`${config.url}/action/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: API_VERSION,
      'api-key': config.apiKey,
    },
    body: JSON.stringify({
      dataSource: config.dataSource,
      database: config.database,
      ...payload,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MongoDB Data API ${action} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}
