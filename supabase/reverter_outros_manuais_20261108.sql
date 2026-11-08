-- ============================================================
-- Reversão do reprocessamento de 08/11/2026.
--
-- 21 compras estavam em "Outros" com categoria_origem = 'MANUAL' — a maior
-- parte por causa do ciclo antigo (salvar qualquer campo na edição gravava a
-- categoria da IA como manual). Elas foram reprocessadas: 6 receberam
-- categoria pela memória/regra/parcela e 15 voltaram a ser "Outros"
-- automático, para a IA refazer no próximo "Categorizar com IA".
--
-- Este script devolve as 21 exatamente ao estado anterior.
-- ============================================================

UPDATE transacoes_nubank
SET categoria = 'Outros', categoria_origem = 'MANUAL', categoria_confianca = 1.00, classificacao_status = NULL
WHERE hash_linha IN (
  '08bd2c99627334d5ec159bf79f183add9457a412f0e8619d654482e3a6d1a828',
  '106ff305731c73f2719b5fe9f2fd681445d730dd7f773d85fab0ddd208a4bf4b',
  '12508c5934377453dab2791412f24af189fa6a0159bd79b3f34d7766cc807f4e',
  '3909d907114f39439958f6548314768ef734d0b02f5595b6fea3f13f9a974a1c',
  '410854e90c89aaaed76dc24bf05563d897fc85d8c4b032692ddb15391054a6c4',
  '4e07fda9f13cef57c63498f431ff6831cdf60162122aadb74ddd2532972940c9',
  '5a26f55ea8b4d951c3707de884a4abc02aca03caa2ef6529353449dae5665de6',
  '6a176f2dd01349b2bce748a5cd24d55ac1b7ae84d5a6a28fecdd8cbf9b94f2be',
  '7deb2acd1018471018c16e3d761fd2d92e00790f967ff35d1b4ddc28607892bc',
  '8d1bf876891d2ec4dfca2887e064150d90360ce7d6b208bbe39006d59363184b',
  '921bc51ebbe8644c2ae85bee0c06ee1141e9e5d80b15229b3f3faa18af59fff4',
  'a1bed6d801e44b576523d6e0fabf40e08bad4a2636ee3c99e9f5f4cfb8c01fea',
  'a3b477fa2a4c1f1f6dc7d05d318dbf0ad5a6f58d9936fafa9f24f18e60351e07',
  'c5f3a03cddb204aaed6c5044b1effbb06e9c34f3c05811c4767dd6860b466034',
  'ccc560025d962791c643b7fa0246a0894f2137082ff849b4fcef42ec663cde50',
  'd0347452f9fbc3e4f7196f08a0d6857df5abf62579e36116217d8abc4a9067ab',
  'd4fa4b37212e7833f66b04dc78612d19f0a6f73971d0b80c83d9413ed1720466',
  'e6c68eb1cdf406b74e3c6eff8186b066f5ced3574675052f738f3bc2ac99a5fd',
  'e7d51fc8c798c3cd49fb91159882638d924ab6a967cf959d2a551dc7a9a7d56e'
);

UPDATE transacoes_nubank
SET categoria = 'Outros', categoria_origem = 'MANUAL', categoria_confianca = NULL, classificacao_status = NULL
WHERE hash_linha IN (
  '797185a08f12442afb86195f8b0c9d7ad1c348b4c6aa95ce2fa0a6c4e19a326c',
  'b49a1badecf25d4ba42e6da0629e3af923826a22909102d14178dcf2ec7ac594'
);
