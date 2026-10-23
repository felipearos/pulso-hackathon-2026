import { createDemoClock } from "../clock/demo-clock";
import { databasePath } from "../config";
import { migrate, openDatabase } from "../db";
import { systemClock } from "../real-ports";
import { resetPatricia } from "./fixtures";
import { createStore } from "./store";

// Puts the SQLite file back at the starting point of Patricia's story, without
// building the real app: no port that needs a secret is touched.
const db = openDatabase(databasePath());
migrate(db);
const clock = createDemoClock(db, systemClock);
const store = createStore(db, clock);
resetPatricia(db, store, clock);
console.log(
  `Patricia vuelve al inicio: ${store.estadosDeCuenta().length} estados de cuenta y ${store.senales().length} señales cargados.`,
);
db.close();
