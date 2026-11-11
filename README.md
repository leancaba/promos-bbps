# Directorio de locales y promociones · Bahía Blanca Plaza Shopping

Web pública con los locales del shopping (logo + nombre, orden alfabético, 7 columnas en computadora y 4 en celular), buscador, filtro por rubro, orden A→Z / Z→A y ventana emergente con las promociones de cada local. Incluye un panel de administrador protegido con PIN.

## Cómo se guardan los datos

Todo queda **dentro del propio repositorio**:

| Qué | Dónde |
| --- | --- |
| Locales, rubros y promociones | `data/locales.json` |
| Logos de los locales | `uploads/logos/` |
| Gráficas promocionales | `uploads/promos/` |

Cuando guardás algo en el panel, el servidor de Vercel hace un *commit* al repositorio con los archivos nuevos. Vercel detecta el cambio y vuelve a publicar la web sola: **los cambios se ven en la web pública en aproximadamente un minuto**.

Las imágenes se optimizan en el navegador antes de subirse:
- Gráfica de escritorio: se recorta al centro a **2066 × 618 px**.
- Gráfica mobile: se recorta al centro a **1024 × 1024 px** (si no hay, en celulares se usa la de escritorio).
- Logos: se achican hasta 600 px y conservan la transparencia (PNG/WEBP).

## Puesta en marcha

### 1. Subir a GitHub
Creá un repositorio nuevo (por ejemplo `directorio-bbps`) y subí todos los archivos de esta carpeta, en la rama `main`.

### 2. Crear un token de GitHub
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access*: **Only select repositories** → elegí `directorio-bbps`.
3. *Permissions → Repository permissions → Contents*: **Read and write**.
4. Generalo y copiá el token (empieza con `github_pat_…`).

### 3. Importar en Vercel
1. Vercel → **Add New → Project** → importá el repositorio. No hace falta cambiar nada de la configuración (Framework: *Other*).
2. Antes de publicar, en **Environment Variables** agregá:

| Variable | Valor |
| --- | --- |
| `ADMIN_PIN` | El PIN del panel (recomendado: 6 dígitos o más) |
| `GITHUB_TOKEN` | El token del paso 2 |
| `GITHUB_REPO` | `tu-usuario/directorio-bbps` |
| `GITHUB_BRANCH` | `main` (opcional, es el valor por defecto) |

3. **Deploy**. Si agregás o cambiás variables después, hacé *Redeploy* para que tomen efecto.

### 4. Usar el panel
- Al pie de la web: **ADMINISTRADOR → PIN → ENTRAR**, o directamente `tu-web.vercel.app/admin`.
- **Gráficas promocionales**: *Cargar imagen* → revisá la vista previa → *Guardar*. También podés quitar una gráfica.
- **Locales y promociones**: nombre, rubro (se usa para los filtros), logo y todas las promos que quieras (*Agregar promo*). *Guardar* crea el local.
- En la lista de abajo: **Editar** carga el local en el formulario; **Borrar** lo elimina junto con su logo.

### 5. Descargar los logos (una sola vez)
El repositorio viene precargado con los **114 locales** de bahiablancaplazashopping.com/locales, con su nombre y rubro. Al principio los logos se muestran desde la web del shopping. Para que queden guardados en el repositorio:

1. Entrá al panel.
2. En el recuadro de **Locales y promociones**, tocá **DESCARGAR LOGOS AL REPOSITORIO**.
3. El servidor los baja en tandas de 15 y los guarda en `uploads/logos/`. Si alguno falla, se sigue viendo desde la web del shopping y podés reintentar o cargarlo a mano.

Un local puede tener **varios rubros separados por coma** (por ejemplo `Moda Mujer, Moda Hombre`) y aparece en cada filtro.

## Probar en tu computadora (opcional)
Con Node.js 18 o superior:

```bash
node dev-server.js
```

Abrí http://localhost:3000 — el PIN de prueba es `1234`. En este modo los cambios se guardan directo en la carpeta (no toca GitHub).

## Estructura
```
index.html        Web pública
admin.html        Panel de administrador
css/              Estilos (style.css compartido, admin.css del panel)
js/app.js         Grilla, buscador, filtros, orden, ventana emergente y animaciones
js/admin.js       Panel: carga y recorte de imágenes, locales, promos, editar y borrar
api/              Funciones de Vercel (login, lectura y guardado en GitHub)
data/locales.json Datos
uploads/          Logos y gráficas
img/              Logo del shopping y favicon
```
