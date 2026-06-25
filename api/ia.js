export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizarBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return {};
      }
    }
    return body;
  }

  function limitarDataset(dataset) {
    const texto = JSON.stringify(dataset || {});
    if (texto.length > 700000) {
      throw new Error('Dataset muito grande para análise. Reduza a quantidade de linhas enviadas.');
    }
    return texto;
  }

  function montarPrompt(question, datasetTexto) {
    return `
Você é um analista sênior de BI comercial e financeiro para varejo.

Sua missão é responder à pergunta do usuário usando exclusivamente os dados enviados.
Não invente números.
Não use conhecimento externo.
Não diga que não consegue analisar se os dados necessários estiverem disponíveis.
Se houver dados insuficientes, explique exatamente o que falta.

Regras de inteligência analítica:
1. Sempre priorize evidências numéricas.
2. Compare mês atual contra mês anterior quando houver dados.
3. Para filiais, avalie resultado, margem líquida, faturamento, vendas, ticket médio, break-even, despesas e tendência.
4. Se a pergunta envolver "fechar filial", "encerrar filial" ou "qual filial deve ser fechada", NÃO responda como decisão definitiva.
   Responda como ranking de risco operacional e recomendação de revisão gerencial.
5. Uma filial crítica geralmente combina:
   - resultado negativo;
   - margem líquida negativa ou muito baixa;
   - faturamento abaixo do break-even;
   - queda de faturamento;
   - queda de resultado;
   - baixa participação no faturamento;
   - despesa alta em relação ao faturamento.
6. Se existir rankingRiscoFiliais no dataset, use esse ranking como principal base da análise.
7. Não recomende fechamento apenas por faturamento baixo se a filial for lucrativa.
8. Não recomende fechamento apenas por resultado negativo se faltar análise de contrato, aluguel, estoque, equipe, localização e estratégia.
9. Quando usar percentual de margem, deixe claro se é percentual. Quando comparar margens, use pontos percentuais.
10. Responda em português do Brasil, com tom executivo, direto e útil.

Pergunta do usuário:
${question}

Dados disponíveis:
${datasetTexto}
`;
  }

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      subtitle: { type: 'STRING' },
      insights: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      cards: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            value: { type: 'STRING' },
            detail: { type: 'STRING' },
            status: {
              type: 'STRING',
              enum: ['good', 'bad', 'neutral']
            }
          },
          required: ['title', 'value', 'detail', 'status']
        }
      },
      tables: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            columns: {
              type: 'ARRAY',
              items: { type: 'STRING' }
            },
            rows: {
              type: 'ARRAY',
              items: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              }
            }
          },
          required: ['title', 'columns', 'rows']
        }
      },
      charts: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              enum: ['bar', 'donut']
            },
            title: { type: 'STRING' },
            labels: {
              type: 'ARRAY',
              items: { type: 'STRING' }
            },
            values: {
              type: 'ARRAY',
              items: { type: 'NUMBER' }
            },
            valuePrefix: { type: 'STRING' },
            valueSuffix: { type: 'STRING' }
          },
          required: ['type', 'title', 'labels', 'values', 'valuePrefix', 'valueSuffix']
        }
      }
    },
    required: ['title', 'subtitle', 'insights', 'cards', 'tables', 'charts']
  };

  try {
    const body = normalizarBody(req.body);
    const { question, dataset } = body;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
    }

    if (!question) {
      return res.status(400).json({ error: 'Pergunta não informada' });
    }

    if (!dataset) {
      return res.status(400).json({ error: 'Dataset não informado' });
    }

    const datasetTexto = limitarDataset(dataset);
    const prompt = montarPrompt(question, datasetTexto);

    const modelos = [
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ];

    let ultimoErro = null;

    for (const model of modelos) {
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        let response;
        let data;

        try {
          response = await fetch(
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
                  temperature: 0.15,
                  topP: 0.8,
                  responseMimeType: 'application/json',
                  responseSchema
                }
              })
            }
          );

          data = await response.json();
        } catch (error) {
          ultimoErro = { error: error.message, model, tentativa };
          await sleep(1000 * tentativa);
          continue;
        }

        if (response.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

          try {
            return res.status(200).json(JSON.parse(text));
          } catch {
            return res.status(200).json({
              title: 'Resposta Gemini',
              subtitle: 'A resposta não veio em JSON estruturado.',
              insights: [text || 'A IA não retornou conteúdo.'],
              cards: [],
              tables: [],
              charts: []
            });
          }
        }

        ultimoErro = data;

        const status = data?.error?.status;
        const code = data?.error?.code;

        if (
          code === 503 ||
          status === 'UNAVAILABLE' ||
          code === 429 ||
          status === 'RESOURCE_EXHAUSTED'
        ) {
          await sleep(1000 * tentativa);
          continue;
        }

        if (code === 404 || status === 'NOT_FOUND') {
          break;
        }

        return res.status(response.status).json({
          error: 'Erro ao consultar Gemini',
          model,
          detail: data
        });
      }
    }

    return res.status(503).json({
      error: 'Todos os modelos Gemini testados retornaram indisponibilidade, limite temporário ou não estão disponíveis.',
      detail: ultimoErro
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Erro interno no proxy',
      detail: error.message
    });
  }
}
