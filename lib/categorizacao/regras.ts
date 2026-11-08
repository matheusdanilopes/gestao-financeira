/**
 * Regras fixas para estabelecimentos inequívocos — rápidas, grátis e
 * consistentes. Ficam DEPOIS da memória do casal no pipeline: quando eles já
 * escolheram outra coisa para um lugar, vale a escolha deles.
 *
 * Só entra aqui o que não depende de hábito. Posto é o exemplo do contrário:
 * nos rótulos reais, "Vegas Auto Posto" é Alimentação (lanche na conveniência)
 * e "Flexx Iguatemi" é Combustível — por isso a regra de posto olha o valor e,
 * na faixa ambígua, deixa para a IA.
 */

export interface DecisaoRegra {
  categoria: string
  confianca: number
  motivo: string
}

interface Regra {
  nome: string
  padrao: RegExp
  /** Primeira categoria permitida da lista vence (ex.: Streaming, se existir; senão Lazer). */
  categorias: string[]
  /** Condição extra sobre o valor da compra. */
  valor?: (v: number) => boolean
}

const REGRAS: Regra[] = [
  { nome: 'app de transporte', padrao: /\b(uber|uberrides|uber trip|99 ?app|99 ?pop|99 tecnologia|cabify|indrive|indriver)\b/, categorias: ['Transporte'] },
  { nome: 'estacionamento/pedágio', padrao: /\b(estacionamento\w*|estapar|zul digital|zona azul|sem parar|conectcar|veloe|move mais|nutag|pedagio)\b/, categorias: ['Transporte'] },
  { nome: 'farmácia', padrao: /\b(remedio\w*|drogaria\w*|drogamais|drog|drogasil|droga ?raia|raia\d*|farmacia\w*|pague menos|panvel|drogao|nissei|farma ponte)\b/, categorias: ['Saúde'] },
  { nome: 'saúde', padrao: /\b(unimed|hospital|clinica\w*|laboratorio\w*|odonto\w*|dentista|medic[oa]s?|consultorio|otica\w*|oculos|fisioterapia|psicolog\w*|pilates|smart ?fit|bluefit|academia)\b/, categorias: ['Saúde'] },
  // Depois de farmácia/saúde: "iFood Remédios" é Saúde, não delivery de comida.
  { nome: 'delivery de comida', padrao: /\b(ifood|ifoodcom|rappi|aiqfome|ze delivery|james delivery)\b/, categorias: ['Alimentação'] },
  { nome: 'streaming de vídeo', padrao: /\b(netflix|disney|hbo|max com|globoplay|prime ?video|paramount|crunchyroll|apple tv|telecine|mubi)\b/, categorias: ['Streaming', 'Lazer'] },
  { nome: 'música', padrao: /\b(spotify|deezer|youtube music|tidal)\b/, categorias: ['Música', 'Streaming', 'Lazer'] },
  { nome: 'leitura', padrao: /\b(kindle|audible|skeelo|kobo)\b/, categorias: ['Lazer', 'Educação'] },
  { nome: 'jogos', padrao: /\b(steam|playstation|psn|xbox|nintendo|riot games|epic games|garena)\b/, categorias: ['Jogos', 'Lazer'] },
  { nome: 'software e IA', padrao: /\b(anthropic|claude ai|claude|openai|chatgpt|lovable|github|vercel|supabase|notion|canva|adobe|microsoft|google one|google cloud|icloud|apple com bill|apple com br|dropbox|cursor)\b/, categorias: ['Tecnologia'] },
  { nome: 'eletrônicos', padrao: /\b(kabum|fastshop|fast shop|samsung|xiaomi|positivo|acessorios para cel\w*|celulares?)\b/, categorias: ['Tecnologia'] },
  { nome: 'roupas e calçados', padrao: /\b(renner|riachuelo|zara|hering|shein|centauro|netshoes|marisa|pernambucanas|youcom|cea modas|calcados|calcado|sapataria)\b/, categorias: ['Vestuário'] },
  { nome: 'cosméticos', padrao: /\b(boticario|oboticario|natura|sephora|eudora|avon|quem disse berenice|perfumaria|mac cosmetics|granado)\b/, categorias: ['Cosméticos', 'Beleza'] },
  { nome: 'serviço de beleza', padrao: /\b(salao|cabeleire\w*|barbearia|manicure|esmalteria|depila\w*|estetica|sobrancelha|lash)\b/, categorias: ['Beleza', 'Cosméticos'] },
  { nome: 'supermercado', padrao: /\b(supermercado\w*|super mercado|hipermercado|atacadao|atacadista|assai|carrefour|angeloni|condor|muffato|big ?bom|savegnago|hortifruti|sacolao|cidade cancao)\b/, categorias: ['Mercado'] },
  { nome: 'comer fora', padrao: /\b(restaurante\w*|restau|lanchonete|lanches|padaria|panificadora|panificac\w*|bakery|pizzaria|hamburgueria|burger|mc ?donalds|subway|outback|cafeteria|cafe|sorveteria|acai|doceria|confeitaria|churrascaria|sushi|temakeria|pastelaria|food|bar e restau)\b/, categorias: ['Alimentação'] },
  { nome: 'pet', padrao: /\b(petz|cobasi|petlove|pet ?shop|veterinari\w*|agropet)\b/, categorias: ['Pet'] },
  { nome: 'viagem', padrao: /\b(airbnb|booking|decolar|latam|gol linhas|voegol|azul linhas|voeazul|hotel|pousada|hostel|buser|rodoviaria|123 ?milhas|maxmilhas)\b/, categorias: ['Viagem'] },
  { nome: 'lazer', padrao: /\b(cinema|cinemark|cinepolis|ingresso\w*|sympla|eventim|teatro|parque)\b/, categorias: ['Lazer'] },
  { nome: 'educação', padrao: /\b(udemy|alura|coursera|hotmart|escola|colegio|faculdade|universidade|curso\w*|livraria)\b/, categorias: ['Educação'] },
  // Posto: valor alto é abastecimento; valor baixo é lanche na conveniência.
  { nome: 'abastecimento', padrao: /\b(posto|auto posto|shell|ipiranga|petrobras|br mania|ale combustiveis)\b/, categorias: ['Combustível'], valor: v => v >= 60 },
  { nome: 'conveniência de posto', padrao: /\b(posto|auto posto|br mania|am pm|ampm)\b/, categorias: ['Alimentação'], valor: v => v > 0 && v < 30 },
]

export function aplicarRegras(chave: string, valor: number, permitidas: string[]): DecisaoRegra | null {
  for (const r of REGRAS) {
    if (!r.padrao.test(chave)) continue
    if (r.valor && !r.valor(Math.abs(valor))) continue
    const categoria = r.categorias.find(c => permitidas.includes(c))
    if (categoria) return { categoria, confianca: 0.9, motivo: `regra: ${r.nome}` }
  }
  return null
}
