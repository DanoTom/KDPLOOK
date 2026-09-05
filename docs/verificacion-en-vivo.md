# Encargo de verificación en vivo

Todo lo que hay en esta app está probado contra fixtures escritos a mano y
contra dos CSV reales. Desde el entorno donde se desarrolla, Amazon **no es
alcanzable**: nunca se ha comprobado ni una sola cifra contra la página que ve
una persona. Este documento es lo que le pediría a un agente con navegador y
acceso a la herramienta desplegada.

Está ordenado por **qué cambiaría del código si la respuesta viene mal**, no por
lo interesante que suena. Los dos primeros son regresiones que pude haber
introducido esta semana y que fallarían en silencio.

---

## 1. ¿Se están tirando libros de verdad? (riesgo más alto)

**Qué se cambió.** Una fila cuya ficha no se abrió solo cuenta como libro si su
tarjeta trae formato («Tapa blanda», «Versión Kindle», «Tapa dura», «Libro de
bolsillo»). El razonamiento fue: *todo libro de Amazon lleva formato y unos
auriculares no*. Esa frase no está verificada contra amazon.es.

**Por qué importa.** Si hay libros reales cuya tarjeta no muestra formato, se
están borrando de **todas** las cifras del nicho sin decir nada, y los nichos
salen más vacíos de lo que están. Es exactamente el error contrario al que se
quería arreglar.

**Qué medir.** En 8-10 búsquedas de amazon.es, para cada resultado orgánico de
la primera página: ¿es un libro?, ¿la tarjeta muestra formato?, ¿qué dice la
columna `es_libro_kdp` del CSV exportado?

**Qué devolver.** La tabla cruzada completa, sin resumir. Interesan sobre todo
los **falsos negativos**: libros de verdad marcados `no`.

**Qué haría yo.** Con más de un 2% de falsos negativos, el test por formato está
mal y hay que buscar otra señal (marca frente a autor, presencia de ASIN de
libro, ausencia de precio de electrónica).

---

## 2. ¿Se están marcando como anuncio cosas que no lo son?

**Qué se cambió.** Antes, una página sin resultados orgánicos se analizaba
usando los patrocinados como si fueran el mercado. Ya no: ahora dice «sin
resultados orgánicos», que es un veredicto fuerte —*nadie ha publicado para este
término*—.

**Por qué importa.** Si la detección de patrocinados tiene falsos positivos, una
página sana se convierte en ese veredicto, que es la conclusión opuesta. Se
introdujo esta semana y nunca se ha visto contra la tienda real.

**Qué medir.** Por búsqueda: cuántas filas marca la herramienta como
patrocinadas frente a cuántas llevan de verdad la etiqueta «Patrocinado» en la
página. Y si alguna búsqueda con libros orgánicos evidentes acaba reportando
cero.

**Qué devolver.** Los ASIN de cada desacuerdo, en los dos sentidos.

---

## 3. La tabla real de BSR por posición en amazon.es

**Por qué importa.** Es el dato que nunca he tenido. Toda la aritmética de la
app —ventas estimadas, regalías, el listón del badge, la puerta de demanda—
descansa sobre tablas de anclas **extrapoladas**, no medidas. La de España se
dedujo del tamaño relativo del mercado.

**Qué medir.** En 5-6 categorías de amazon.es de tamaños distintos (una grande
tipo «Libros», una media, una pequeña de cola larga), el **BSR real** de los
puestos 1, 5, 10, 25, 50 y 100 de su lista de más vendidos. En papel y en
Kindle por separado, porque son rankings distintos.

**Qué devolver.** La tabla cruda de posición → BSR. Nada más; no hace falta
interpretarla.

**Qué haría yo.** Reajustar las anclas con datos medidos en vez de deducidos.
Ojo: esto **no valida** la curva —para eso hacen falta unidades vendidas
reales, ver el apartado final— pero sí detecta absurdos, como que el #100 de
una lista de más vendidos implique cero ventas al mes.

---

## 4. Fidelidad campo a campo

**Por qué importa.** El tipo de fallo que más veces ha mordido en este proyecto
es el **nulo silencioso**: un campo que deja de leerse, se trata como cero, y
produce una conclusión invertida. Ha pasado dos veces con las reseñas.

**Qué medir.** Para ~60 libros (los 10 primeros de 6 búsquedas), comparar contra
la ficha real: `titulo`, `precio`, `resenas`, `valoracion`, `formato`, `bsr`,
`paginas`, `editorial`, `publicado`, `categorias_bsr`.

**Qué devolver.** Por campo: % que sale vacío y % que sale con un valor
distinto al de la página. Y las filas concretas de cada valor distinto.

**Qué haría yo.** Un campo con más de un 10% de vacíos es un parser roto, no un
dato que Amazon no da.

---

## 5. Lo que propone «Buscar ideas», ¿es basura?

**Qué se cambió.** Extrae frases repetidas entre los títulos más vendidos de una
categoría y las ofrece como subnichos que buscar. Al renderizarla proponía
«sin», «toda» y «recetas»; se le pusieron reglas (dos palabras con significado,
la repetición satura pronto), pero calibradas contra una lista de cocina
**inventada por mí**.

**Qué medir.** En 5 ramas reales de amazon.es, para cada frase propuesta:
¿es algo que una persona escribiría en el buscador, o es un fragmento?

**Qué devolver.** La lista completa de frases con ese juicio y el motivo. La
tasa de falsos positivos es el número que busco.

**Qué haría yo.** Por encima del 20% de fragmentos, hay que subir el mínimo de
palabras con significado o el umbral de genericidad.

---

## 6. El clasificador de contenido

**Qué se cambió.** El corte pasó a ser la tarifa plana de KDP (108 páginas) y el
precio desempata con el techo de bajo contenido (8 €). Cambia el suelo de precio
y el listón de reseñas de cada informe.

**Qué medir.** En 20 nichos variados: qué etiqueta pone la herramienta (bajo /
medio / alto) y qué diría una persona mirando las portadas y las páginas.

**Qué devolver.** Los desacuerdos con la mediana de páginas y de precio de cada
nicho, para poder ver si el corte está en el sitio.

---

## 7. ¿Cuánto bloquea Amazon al Worker?

**Por qué importa.** Las pantallas de ideas y de colocación dependen de que el
Worker pueda leer listas de más vendidos. Si eso se bloquea a menudo, esas dos
funciones hay que llevarlas al bookmarklet.

**Qué medir.** Sobre ~50 peticiones repartidas (búsquedas, fichas, listas de
más vendidos): porcentaje que vuelve bloqueado o recortado, y si la app lo dice
o lo disimula.

---

## Lo que un agente NO puede darme

**Ventas reales.** Ninguna cantidad de scraping produce unidades vendidas: eso
solo está en el panel de regalías de KDP. Es la única forma de validar de verdad
la curva BSR→ventas, que es el cimiento de todo lo demás.

Eso lo tiene que hacer el propio editor, y la app ya lo soporta: Ajustes acepta
muestras de *(ventas reales al mes, BSR de ese momento, formato, tienda)* y
`suggestCalibration` calcula el multiplicador que haría coincidir la curva con
la realidad. Con tres o cuatro meses de datos propios, la calibración deja de
ser una suposición.

---

## Cómo quiero el informe

- **Filas crudas, no resúmenes.** Un «95% de acierto» esconde justo los casos
  que necesito ver. Que venga la lista de desacuerdos.
- **Un apartado por número, con el commit contra el que se ejecutó.**
- **Sin arreglar nada.** Varios umbrales de esta app son decisiones deliberadas
  y documentadas que parecen errores desde fuera: el lanzamiento son 2 meses y
  no 30 días *a propósito* (miden cosas distintas, está explicado en
  `reliability.ts`), y acotar el autosuggest a Libros ya se probó y se descartó
  porque en amazon.es responde en inglés. Un agente que «optimice» sin ese
  contexto deshace decisiones reales. Que informe; ya decidiré yo.
- **Si algo no se pudo comprobar, decirlo.** Un hueco declarado vale más que un
  número inventado — que es, en el fondo, de lo que va toda esta herramienta.
