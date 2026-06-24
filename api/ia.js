export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const { question, dataset } = req.body || {};
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
    }

    const prompt = `
Você é um analista sênior de dados comerciais e financeiros de varejo.

Responda exclusivamente em JSON válido.
Não use markdown.
Não invente dados.
Use somente os dados recebidos.

Formato obrigatório:
{
  "title": "string",
  "subtitle": "string",
  "insights": ["string"],
  "cards": [
    {
      "title": "string",
      "value": "string",
      "detail": "string",
      "status": "good|bad|neutral"
    }
  ],
  "tables": [
    {
      "title": "string",
      "columns": ["string"],
      "rows": [["string"]]
    }
  ],
  "charts": [
    {
      "type": "bar|donut",
      "title": "string",
      "labels": ["string"],
      "values": [0],
      "valuePrefix": "string",
      "valueSuffix": "string"
    }
  ]
}

Pergunta do usuário:
${question}

Dados:
${JSON.stringify(dataset)}
`;

    const modelos = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

    let ultimoErro = null;

    for (const model of modelos) {
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json'
              }
            })
          }
        );

        const data = await response.json();

        if (response.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

          try {
            return res.status(200).json(JSON.parse(text));
          } catch {
            return res.status(200).json({
              title: 'Resposta Gemini',
              subtitle: 'A resposta não veio em JSON estruturado',
              insights: [text],
              cards: [],
              tables: [],
              charts: []
            });
          }
        }

        ultimoErro = data;

        const status = data?.error?.status;
        const code = data?.error?.code;

        if (code === 503 || status === 'UNAVAILABLE' || code === 429 || status === 'RESOURCE_EXHAUSTED') {
          await sleep(1000 * tentativa);
          continue;
        }

        return res.status(response.status).json({
          error: 'Erro ao consultar Gemini',
          model,
          detail: data
        });
      }
    }

    return res.status(503).json({
      error: 'Todos os modelos Gemini testados retornaram indisponibilidade ou limite temporário.',
      detail: ultimoErro
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Erro interno no proxy',
      detail: error.message
    });
  }
}
