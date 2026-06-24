export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const { question, dataset } = req.body || {};

    if (!question || !dataset) {
      return res.status(400).json({
        error: "Pergunta ou dados não informados"
      });
    }

    const datasetTexto = JSON.stringify(dataset);

    // Evita envio acidental de conjuntos enormes
    if (datasetTexto.length > 300000) {
      return res.status(413).json({
        error: "O conjunto de dados é muito grande"
      });
    }

    const input = [
      {
        role: "system",
        content:
          "Você é um analista sênior de dados comerciais e financeiros. " +
          "Use somente os dados fornecidos e não invente números. " +
          "Responda exclusivamente com JSON válido, sem markdown. " +
          "Formato obrigatório: " +
          '{"title":"string","subtitle":"string","insights":["string"],' +
          '"cards":[{"title":"string","value":"string","detail":"string",' +
          '"status":"good|bad|neutral"}],' +
          '"tables":[{"title":"string","columns":["string"],"rows":[["string"]]}],' +
          '"charts":[{"type":"bar|donut","title":"string","labels":["string"],' +
          '"values":[0],"valuePrefix":"string","valueSuffix":"string"}]}'
      },
      {
        role: "user",
        content:
          "Pergunta: " + question +
          "\n\nDados do dashboard:\n" +
          datasetTexto
      }
    ];

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          input
        })
      }
    );

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("Erro OpenAI:", data);

      return res.status(openaiResponse.status).json({
        error: "Erro ao consultar a IA"
      });
    }

    const texto = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("");

    if (!texto) {
      return res.status(502).json({
        error: "A IA não retornou um relatório"
      });
    }

    const textoLimpo = texto
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return res.status(200).json(JSON.parse(textoLimpo));

  } catch (erro) {
    console.error(erro);

    return res.status(500).json({
      error: "Erro interno ao gerar relatório"
    });
  }
}
