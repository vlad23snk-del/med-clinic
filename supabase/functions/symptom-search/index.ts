// Edge Function: symptom-search
// Принимает жалобу пациента, спрашивает у OpenAI подходящего специалиста
// и возвращает JSON { specialty, advice, urgency }.
// Ключ OpenAI берётся из секрета OPENAI_API_KEY (в коде его нет).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Браузер сначала шлёт preflight-запрос OPTIONS — отвечаем разрешением
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const { symptoms, specialties, sex } = await req.json();

    if (!symptoms || !String(symptoms).trim()) {
      return json({ error: "Опишите, что вас беспокоит." }, 400);
    }

    const sexText = sex === "male" ? "мужской" : sex === "female" ? "женский" : "не указан";

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "Сервис не настроен: отсутствует ключ OpenAI." }, 500);
    }

    const list = Array.isArray(specialties) && specialties.length
      ? specialties.join(", ")
      : "Терапевт";

    const system = `Ты — помощник регистратуры медицинской клиники.
Пациент описывает жалобу на русском языке. Порекомендуй подходящего специалиста ТОЛЬКО из этого списка: ${list}.
Если жалоба неясна или не относится к медицине — рекомендуй "Терапевт".

ГЛАВНОЕ ПРАВИЛО О ПОЛЕ ПАЦИЕНТА. Пол пациента: ${sexText}. Пол — неоспоримый факт, он ВАЖНЕЕ формулировок жалобы. Соблюдай строго:
- Мужчине НИКОГДА не рекомендуй "Гинеколог" (у мужчин нет женских репродуктивных органов). Мужские мочеполовые жалобы → "Уролог".
- Женщине "Уролог" — только при жалобах мочевой системы (почки, мочевой пузырь); женские репродуктивные жалобы → "Гинеколог".
- Если жалоба упоминает органы, которых у пациента этого пола нет (мужчина пишет про яичники/матку, женщина — про простату/потенцию), это ошибка в словах пациента: НЕ бери гендерного специалиста, выбери нейтрального ("Терапевт" или "Хирург").
- Если пол "не указан" — не предполагай его и не рекомендуй гендерно-специфичных специалистов ("Гинеколог"/"Уролог"), выбери нейтрального.
Отвечай СТРОГО в формате JSON с полями:
- "specialty": ровно один специалист из списка выше;
- "advice": короткий полезный совет пациенту на русском (2-3 предложения, простыми словами);
- "urgency": одно из значений "routine" (планово), "soon" (лучше скоро), "emergency" (срочно/неотложно).
Не ставь диагнозов и не назначай конкретные лекарства.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Пол пациента: ${sexText}.\nЖалоба: ${String(symptoms)}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Ошибка обращения к нейросети.", detail }, 502);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { specialty: "Терапевт", advice: content, urgency: "routine" };
    }

    return json(parsed);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
