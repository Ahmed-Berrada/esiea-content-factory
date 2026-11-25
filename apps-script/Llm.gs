/**
 * Llm.gs — appel d'IA par API. Fournisseur et modèle = cellules Config (PROVIDER, MODEL).
 * Changer de fournisseur = changer une cellule (+ ajouter la clé API_KEY_<PROVIDER> dans les propriétés du script).
 */

/** Schéma JSON unique pour tous les formats texte → un nouveau format n'exige aucun code. */
var OUTPUT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    titre: { type: 'STRING' },
    contenu: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titre: { type: 'STRING' },
          texte: { type: 'STRING' },
          temps: { type: 'STRING' },
          fin: { type: 'STRING' }
        }
      }
    },
    hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
    faits_sources: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['titre', 'contenu', 'items']
};

var JSON_INSTRUCTION = '\n\nRéponds UNIQUEMENT avec un objet JSON valide de la forme : ' +
  '{"titre": "...", "contenu": "...", "items": [{"titre": "...", "texte": "...", "temps": "mm:ss", "fin": "mm:ss"}], ' +
  '"hashtags": ["..."], "faits_sources": ["chaque chiffre, date, nom ou formation utilisé, recopié de la source"]}. ' +
  'Les champs inutiles pour ce format restent vides ("" ou []).';

/**
 * @param {Object} req {system, user, model?, json?, schema?, temperature?}
 * @return {Object} {text, tokensIn, tokensOut, model, provider}
 */
function callLlm_(req) {
  var cfg = getConfig_();
  var provider = String(req.provider || cfg.PROVIDER || 'gemini').toLowerCase();
  var model = String(req.model || cfg.MODEL);
  var temperature = req.temperature !== undefined ? req.temperature : cfgNum_('TEMPERATURE', 0.6);
  var maxTokens = cfgNum_('MAX_OUTPUT_TOKENS', 8192);
  var key = getApiKey_(provider);
  var url, payload, headers = {};

  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    headers['x-goog-api-key'] = key;
    payload = {
      systemInstruction: { parts: [{ text: req.system || '' }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { temperature: temperature, maxOutputTokens: maxTokens }
    };
    if (req.json) {
      payload.generationConfig.responseMimeType = 'application/json';
      if (req.schema !== false) payload.generationConfig.responseSchema = req.schema || OUTPUT_SCHEMA;
    }
    var tb = getConfig_().THINKING_BUDGET;
    if (tb !== '' && tb !== undefined && /2\.5/.test(model)) payload.generationConfig.thinkingConfig = { thinkingBudget: Number(tb) };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers.Authorization = 'Bearer ' + key;
    payload = {
      model: model, temperature: temperature, max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: req.system || '' }, { role: 'user', content: req.user }]
    };
    if (req.json) payload.response_format = { type: 'json_object' };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    payload = {
      model: model, max_tokens: maxTokens, temperature: temperature,
      system: req.system || '', messages: [{ role: 'user', content: req.user }]
    };
  } else {
    throw new Error('PROVIDER inconnu : ' + provider);
  }

  var maxAttempts = 4;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 200) return parseLlmResponse_(provider, model, JSON.parse(resp.getContentText()));
    // limites de débit / surcharge → attente exponentielle puis nouvel essai
    if ((code === 429 || code >= 500) && attempt < maxAttempts) {
      Utilities.sleep(Math.min(30000, 2000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 1000));
      continue;
    }
    var err = new Error('API ' + provider + ' HTTP ' + code + ' : ' + resp.getContentText().substring(0, 300));
    err.retryable = code === 429 || code >= 500;
    throw err;
  }
}

function parseLlmResponse_(provider, model, j) {
  var text = '', tin = 0, tout = 0;
  if (provider === 'gemini') {
    var cand = (j.candidates || [])[0];
    if (!cand || !cand.content) throw new Error('Réponse Gemini vide (' + (cand && cand.finishReason) + ')');
    text = cand.content.parts.map(function (p) { return p.text || ''; }).join('');
    var u = j.usageMetadata || {};
    tin = u.promptTokenCount || 0;
    tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  } else if (provider === 'openai') {
    text = j.choices[0].message.content;
    tin = j.usage.prompt_tokens; tout = j.usage.completion_tokens;
  } else {
    text = j.content.map(function (c) { return c.text || ''; }).join('');
    tin = j.usage.input_tokens; tout = j.usage.output_tokens;
  }
  return { text: text, tokensIn: tin, tokensOut: tout, model: model, provider: provider };
}

/** Appel + parse JSON, avec une relance si le JSON est invalide. */
function callLlmJson_(req) {
  var r = callLlm_(req), usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut };
  try {
    r.data = parseJsonLoose_(r.text);
  } catch (e) {
    var r2 = callLlm_({ system: req.system, user: req.user + '\n\nATTENTION : ta réponse précédente n\'était pas un JSON valide. Renvoie uniquement le JSON.', json: true, model: req.model, schema: req.schema });
    usage.tokensIn += r2.tokensIn; usage.tokensOut += r2.tokensOut;
    r2.data = parseJsonLoose_(r2.text);
    r = r2;
  }
  r.tokensIn = usage.tokensIn; r.tokensOut = usage.tokensOut;
  return r;
}

/** Coût en USD à partir des tarifs déclarés dans Config (PRIX_IN:<modele>, PRIX_OUT:<modele>, en $/1M tokens). */
function costUsd_(model, tokensIn, tokensOut) {
  var cfg = getConfig_();
  var pin = Number(cfg['PRIX_IN:' + model]), pout = Number(cfg['PRIX_OUT:' + model]);
  if (isNaN(pin)) pin = Number(cfg.PRIX_IN_DEFAUT) || 0;
  if (isNaN(pout)) pout = Number(cfg.PRIX_OUT_DEFAUT) || 0;
  return Math.round(((tokensIn * pin + tokensOut * pout) / 1e6) * 1e6) / 1e6;
}
