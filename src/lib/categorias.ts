/**
 * Diccionario de categorías y palabras clave.
 * Para agregar o ajustar keywords, editá el array correspondiente — no hace falta tocar
 * la lógica de parseo (ver parser.ts).
 *
 * El orden importa: se evalúa de arriba hacia abajo y se usa la primera categoría que matchea.
 * Poné las categorías más específicas antes que las genéricas si hay solapamiento de palabras.
 */

export interface CategoriaConfig {
  nombre: string;
  keywords: string[];
}

export const CATEGORIAS: CategoriaConfig[] = [
  {
    nombre: "Nafta",
    keywords: ["nafta", "ypf", "shell", "axion", "combustible", "gasoil"],
  },
  {
    nombre: "Luz",
    keywords: ["luz", "cooperativa electrica", "cooperativa eléctrica"],
  },
  {
    nombre: "Agua",
    keywords: ["agua impuesto", "agua casa", "agua"],
  },
  {
    nombre: "Gas",
    keywords: ["gas", "metrogas", "camuzzi"],
  },
  {
    nombre: "Internet",
    keywords: ["internet", "wifi"],
  },
  {
    nombre: "Celular",
    keywords: ["celular", "abono celular", "tuenti", "claro", "movistar"],
  },
  {
    nombre: "Impuestos municipales",
    keywords: [
      "impuesto municipal",
      "impuestos municipales",
      "impuesto",
      "municipal",
      "tasa",
      "patente",
      "inmobiliario",
    ],
  },
  {
    nombre: "Crédito hipotecario",
    keywords: ["hipotecario", "hipoteca", "credito hipotecario", "crédito hipotecario"],
  },
  {
    nombre: "Tarjetas/Crédito",
    keywords: [
      "tarjeta",
      "credito",
      "crédito",
      "resumen",
      "visa",
      "mastercard",
      "master card",
      "supervielles",
      "bna",
    ],
  },
  {
    nombre: "Farmacia",
    keywords: [
      "farmacia",
      "remedios",
      "farmacity",
      "ibuprofeno",
      "paracetamol",
      "solucion fisiologica",
      "solución fisiológica",
      "pastillas",
      "antibioticos",
      "antibióticos",
      "medicamentos",
    ],
  },
  {
    nombre: "Ferretería",
    keywords: ["ferreteria", "ferretería", "tornillos", "herramientas"],
  },
  {
    nombre: "Pinturería",
    keywords: ["pintura", "pintureria", "pinturería", "rodillo", "pincel", "lijas"],
  },
  {
    nombre: "Panadería",
    keywords: ["panaderia", "panadería", "factura", "facturas", "chipa", "pan"],
  },
  {
    nombre: "Carnicería",
    keywords: ["carniceria", "carnicería"],
  },
  {
    nombre: "Almacén",
    keywords: ["almacen", "almacén", "kiosco", "chino", "despensa"],
  },
  {
    nombre: "Supermercado",
    keywords: [
      "super",
      "la anonima",
      "la anónima",
      "coto",
      "dia",
      "carrefour",
      "jumbo",
      "changomas",
      "carne del colegio",
      "super chino",
      "la coope",
      "la coope obrera",
    ],
  },
  {
    nombre: "Cervezas",
    keywords: ["cerveza", "cerveceria", "cervecería", "birra"],
  },
  {
    nombre: "Almuerzo",
    keywords: ["almuerzo", "mediodia", "mediodía"],
  },
  {
    nombre: "Cenas",
    keywords: ["cena", "restaurant", "delivery", "pedido comida"],
  },
  {
    nombre: "Alimento perro",
    keywords: ["alimento perro", "purina", "dog chow", "veterinaria"],
  },
  {
    nombre: "Leña",
    keywords: ["leña", "lena"],
  },
  {
    // Keywords explícitas para "Otros": si el usuario tipea "otros"/"varios" a propósito,
    // esto cuenta como un match real (no como fallback por desconocimiento), lo que permite
    // distinguirlo del caso "no reconocí ninguna palabra clave" que dispara la pregunta de
    // aprendizaje de categoría (ver parser.ts: matchedByKeyword).
    nombre: "Otros",
    keywords: ["otros", "varios"],
  },
];

export const CATEGORIA_DEFAULT = "Otros";

/**
 * Palabras que arrancan un mensaje de carga de gasto y se ignoran al analizar el resto del
 * texto (detección de categoría, descripción y palabra clave a aprender). El matching es
 * insensible a mayúsculas (ver parser.ts), por eso alcanza con listar cada variante de acento
 * una sola vez. Para sumar un sinónimo nuevo, solo hace falta agregarlo acá.
 */
export const PALABRAS_DISPARADORAS = [
  "gasto",
  "gastos",
  "gaste",
  "gasté",
  "pague",
  "pagué",
  "pago",
  "desconte",
  "desconté",
  "cargame",
  "compre",
  "compré",
  "compra",
];

/**
 * Palabras que indican momento del día "mediodía" — usadas por la regla especial de "asado".
 */
export const KEYWORDS_ALMUERZO = ["almuerzo", "mediodia", "mediodía", "mediodia"];
