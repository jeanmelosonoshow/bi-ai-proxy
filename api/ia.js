```javascript
// /api/ia.js

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Método não permitido'
    });
  }

  try {

    const {
      question,
      dataset,
      openai_body
    } = req.body;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY não configurada'
      });
    }

    const prompt = `
Você é um analista sênior de dados comerciais e financeiros especializado em varejo.

RESPONDA EXCLUSIVAMENTE EM JSON.

Formato obrigatório:

{
  "title": "",
  "subtitle": "",
  "insights": [],
  "cards": [],
  "tables": [],
  "charts": []
}

Pergunta do usuário:

${question}

Base de dados:

${JSON.stringify(dataset)}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error(result);

      return res.status(response.status).json({
        error: result
      });
    }

    const text =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {

      const json = JSON.parse(text);

      return res.status(200).json(json);

    } catch {

      return res.status(200).json({
        title: 'Resposta Gemini',
        subtitle: 'Resposta não estruturada',
        insights: [text],
        cards: [],
        tables: [],
        charts: []
      });

    }

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: error.message
    });

  }

}
```
