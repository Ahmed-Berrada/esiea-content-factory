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
      maxItems: 20,
      items: {
        type: 'OBJECT',
        properties: {
          titre: { type: 'STRING' },
          texte: { type: 'STRING' },
          temps: { type: 'STRING' },
          fin: { type: 'STRING' }
        },
        required: ['titre', 'texte']
      }
    },
    hashtags: { type: 'ARRAY', maxItems: 12, items: { type: 'STRING' } },
    faits_sources: { type: 'ARRAY', maxItems: 15, items: { type: 'STRING' } }
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
  var maxTokens = cfgNum_('MAX_OUTPUT_TOKENS', 4096);
  var key = getApiKey_(provider);
  var url, payload, headers = {};
  var userText = req.source ? req.user + '\n\n' + req.source : req.user;  // fournisseurs sans cache explicite

  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    headers['x-goog-api-key'] = key;
    payload = {
      systemInstruction: { parts: [{ text: req.system || '' }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: temperature, maxOutputTokens: maxTokens }
    };
    if (req.json) {
      payload.generationConfig.responseMimeType = 'application/json';
      if (req.schema !== false) payload.generationConfig.responseSchema = req.schema || OUTPUT_SCHEMA;
    }
    var tb = getConfig_().THINKING_BUDGET, tl = getConfig_().THINKING_LEVEL;
    if (/2\.5/.test(model)) {
      if (tb !== '' && tb !== undefined) payload.generationConfig.thinkingConfig = { thinkingBudget: Number(tb) };
    } else if (tl) {
      payload.generationConfig.thinkingConfig = { thinkingLevel: String(tl) };  // Gemini 3.x : low | medium | high
    }
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers.Authorization = 'Bearer ' + key;
    payload = {
      model: model, temperature: temperature, max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: req.system || '' }, { role: 'user', content: userText }]
    };
    if (req.json) payload.response_format = { type: 'json_object' };
  } else if (provider === 'anthropic') {
    // Claude (API Messages). Optimisations de coût :
    //  - le bloc « system » (règles + voix de marque + canal), identique pour toutes les sorties d'un même canal,
    //    est mis en cache (cache_control) : relu à ~0,1x le prix d'entrée au lieu d'être refacturé à chaque sortie ;
    //  - effort bas par défaut (Config EFFORT) : peu de réflexion facturée pour des textes courts ;
    //  - sortie JSON contrainte par schéma (output_config.format) : pas de relance pour JSON invalide.
    // Pas de temperature : refusée par les modèles Claude récents (version d'API 2026-10-21).
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2026-10-21';
    payload = {
      model: model, max_tokens: maxTokens,
      system: [{ type: 'text', text: req.system || ' ', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.source
        ? [{ type: 'text', text: req.source, cache_control: { type: 'ephemeral' } }, { type: 'text', text: req.user }]
        : req.user }],
      output_config: { effort: String(cfg.EFFORT || 'low') }
    };
    if (req.json && req.schema !== false) {
      payload.output_config.format = { type: 'json_schema', schema: toJsonSchema_(req.schema || OUTPUT_SCHEMA) };
    }
  } else {
    throw new Error('PROVIDER inconnu : ' + provider);
  }

  var maxAttempts = getConfig_().MODEL_SECOURS && !req.noFallback ? 2 : 4;  // avec secours : on bascule vite
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var tCall = Date.now();
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    Logger.log('IA ' + provider + '/' + model + ' essai ' + attempt + ' → HTTP ' + code + ' en ' + ((Date.now() - tCall) / 1000).toFixed(1) + ' s');
    if (code === 200) return parseLlmResponse_(provider, model, JSON.parse(resp.getContentText()));
    // limites de débit / surcharge → attente exponentielle puis nouvel essai
    if ((code === 429 || code >= 500) && attempt < maxAttempts) {
      Utilities.sleep(Math.min(30000, 2000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 1000));
      continue;
    }
    var err = new Error('API ' + provider + ' HTTP ' + code + ' : ' + resp.getContentText().substring(0, 300));
    err.retryable = code === 429 || code >= 500;
    // modèle surchargé : bascule automatique sur le modèle de secours (Config MODEL_SECOURS), tracé dans le Journal
    var secours = String(getConfig_().MODEL_SECOURS || '');
    if (err.retryable && secours && secours !== model && !req.noFallback) {
      Logger.log('Modèle ' + model + ' indisponible (HTTP ' + code + ') → secours ' + secours);
      var copy = {}; Object.keys(req).forEach(function (k) { copy[k] = req[k]; });
      copy.model = secours; copy.noFallback = true;
      return callLlm_(copy);
    }
    throw err;
  }
}

function parseLlmResponse_(provider, model, j) {
  var text = '', tin = 0, tout = 0;
  if (provider === 'gemini') {
    var cand = (j.candidates || [])[0] || {};
    var u = j.usageMetadata || {};
    tin = u.promptTokenCount || 0;
    tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    Logger.log('tokens ' + model + ' : entrée ' + tin + ', texte ' + (u.candidatesTokenCount || 0) + ', réflexion ' + (u.thoughtsTokenCount || 0) + ', fin ' + cand.finishReason);
    var parts = (cand.content && cand.content.parts) || [];
    text = parts.map(function (p) { return p.thought ? '' : (p.text || ''); }).join('');
    if (!text.trim()) {
      var e = new Error('Réponse Gemini vide (finishReason=' + cand.finishReason + ', réflexion=' + (u.thoughtsTokenCount || 0) +
        ' tokens) — baisser Config THINKING_LEVEL ou augmenter MAX_OUTPUT_TOKENS');
      e.usage = { tokensIn: tin, tokensOut: tout };
      throw e;
    }
  } else if (provider === 'openai') {
    text = j.choices[0].message.content;
    tin = j.usage.prompt_tokens; tout = j.usage.completion_tokens;
  } else {
    var ua = j.usage || {};
    var cRead = ua.cache_read_input_tokens || 0, cWrite = ua.cache_creation_input_tokens || 0;
    // tokens d'entrée « équivalents facturés » : écriture cache 1,25x, lecture cache 0,1x (tarifs Anthropic)
    tin = Math.round((ua.input_tokens || 0) + 1.25 * cWrite + 0.1 * cRead);
    tout = ua.output_tokens || 0;
    Logger.log('tokens ' + model + ' : entrée ' + (ua.input_tokens || 0) + ', cache écrit ' + cWrite + ', cache lu ' + cRead +
      ', sortie ' + tout + ', fin ' + j.stop_reason);
    if (j.stop_reason === 'refusal') throw new Error('Claude a refusé la demande (' + JSON.stringify(j.stop_details || {}) + ')');
    text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
    if (j.stop_reason === 'max_tokens') throw new Error('Réponse Claude tronquée (max_tokens) — augmenter Config MAX_OUTPUT_TOKENS');
    if (!text.trim()) throw new Error('Réponse Claude vide (stop_reason=' + j.stop_reason + ')');
  }
  return { text: text, tokensIn: tin, tokensOut: tout, model: model, provider: provider };
}

/**
 * Schéma « Gemini » (types en MAJUSCULES, maxItems) → JSON Schema accepté par les sorties structurées Claude :
 * types en minuscules, additionalProperties: false sur chaque objet, contraintes non supportées retirées
 * (maxItems est revérifié par les contrôles de l'onglet Formats).
 */
function toJsonSchema_(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema_);
  if (!s || typeof s !== 'object') return s;
  var out = {};
  Object.keys(s).forEach(function (k) {
    if (k === 'maxItems' || k === 'minItems') return;
    var v = s[k];
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'properties') {
      out.properties = {};
      Object.keys(v).forEach(function (p) { out.properties[p] = toJsonSchema_(v[p]); });
    } else out[k] = toJsonSchema_(v);
  });
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/** Appel + parse JSON, avec une relance si le JSON est invalide. */
function callLlmJson_(req) {
  var r = callLlm_(req), usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut };
  try {
    r.data = parseJsonLoose_(r.text);
  } catch (e) {
    var r2 = callLlm_({ system: req.system, source: req.source, user: req.user + '\n\nATTENTION : ta réponse précédente n\'était pas un JSON valide. Renvoie uniquement le JSON.', json: true, model: req.model, schema: req.schema });
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
