import type { GameDefs } from '../entities/types';
import vehiclesJson from './vehicles.json';
import partsJson from './parts.json';
import repairsJson from './repairs.json';
import suppliersJson from './suppliers.json';

/** Statische Spieldefinitionen – werden nicht im Savegame gespeichert. */
export const DEFS: GameDefs = {
  vehicles: vehiclesJson as GameDefs['vehicles'],
  parts: partsJson as GameDefs['parts'],
  repairs: repairsJson as unknown as GameDefs['repairs'],
  suppliers: suppliersJson as GameDefs['suppliers'],
};
