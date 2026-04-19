const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dir = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dir, 'bot.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS negocios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    enlace      TEXT    NOT NULL,
    total       INTEGER NOT NULL DEFAULT 10,
    hechas      INTEGER NOT NULL DEFAULT 0,
    prioridad   INTEGER NOT NULL DEFAULT 3,
    descripcion TEXT    DEFAULT '',
    activo      INTEGER NOT NULL DEFAULT 1,
    creado      DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS asignaciones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    user_tag   TEXT,
    canal_id   TEXT    NOT NULL,
    cantidad   INTEGER NOT NULL,
    fecha      DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reseñas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    enlace     TEXT    NOT NULL UNIQUE,
    user_id    TEXT    NOT NULL,
    user_tag   TEXT,
    negocio_id INTEGER,
    canal_id   TEXT,
    valida     INTEGER DEFAULT NULL,
    fecha      DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const negocios = {
  getAll:    ()    => db.prepare('SELECT * FROM negocios ORDER BY prioridad DESC, (total-hechas) DESC, creado DESC').all(),
  getActive: ()    => db.prepare('SELECT * FROM negocios WHERE activo=1 AND hechas<total ORDER BY prioridad DESC, (total-hechas) DESC').all(),
  get:       (id)  => db.prepare('SELECT * FROM negocios WHERE id=?').get(id),
  add:       (d)   => db.prepare('INSERT INTO negocios (nombre,enlace,total,prioridad,descripcion) VALUES (@nombre,@enlace,@total,@prioridad,@descripcion)').run(d),
  update:    (id,d)=> db.prepare('UPDATE negocios SET nombre=@nombre,enlace=@enlace,total=@total,prioridad=@prioridad,descripcion=@descripcion,activo=@activo WHERE id=@id').run({...d,id}),
  delete:    (id)  => db.prepare('DELETE FROM negocios WHERE id=?').run(id),
  addHechas: (id,n)=> db.prepare('UPDATE negocios SET hechas=MIN(total,hechas+?) WHERE id=?').run(n, id),
  stats:     ()    => ({
    negocios:  db.prepare('SELECT COUNT(*) as n FROM negocios WHERE activo=1').get().n,
    hechas:    db.prepare('SELECT COALESCE(SUM(hechas),0) as n FROM negocios').get().n,
    necesarias:db.prepare('SELECT COALESCE(SUM(total),0) as n FROM negocios WHERE activo=1').get().n,
  }),
};

const asignaciones = {
  add:       (d)     => db.prepare('INSERT INTO asignaciones (negocio_id,user_id,user_tag,canal_id,cantidad) VALUES (@negocio_id,@user_id,@user_tag,@canal_id,@cantidad)').run(d),
  getRecent: (n=20)  => db.prepare('SELECT a.*,neg.nombre FROM asignaciones a LEFT JOIN negocios neg ON a.negocio_id=neg.id ORDER BY a.fecha DESC LIMIT ?').all(n),
};

const reseñas = {
  get:      (enlace)   => db.prepare('SELECT * FROM reseñas WHERE enlace=?').get(enlace),
  add:      (d)        => db.prepare('INSERT OR IGNORE INTO reseñas (enlace,user_id,user_tag,negocio_id,canal_id) VALUES (@enlace,@user_id,@user_tag,@negocio_id,@canal_id)').run(d),
  setValida:(enlace,v) => db.prepare('UPDATE reseñas SET valida=? WHERE enlace=?').run(v ? 1 : 0, enlace),
};

module.exports = { negocios, asignaciones, reseñas };
