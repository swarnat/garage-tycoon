import type { GameDefs } from '../entities/types';
import vehiclesJson from './vehicles.json';
import partsJson from './parts.json';
import repairsJson from './repairs.json';
import suppliersJson from './suppliers.json';
import toolsJson from './tools.json';

/** Statische Spieldefinitionen – werden nicht im Savegame gespeichert. */
export const CLASS_SPRITES: Record<string, string> = {
  kleinwagen: 'car_kleinwagen',
  limousine: 'car_limousine',
  kompakt: 'car_limousine',
  mittelklasse: 'car_limousine',
  premium: 'car_limousine',
  suv: 'car_suv',
  pickup: 'car_pickup',
  transporter: 'car_transporter',
};

export const DEFS: GameDefs = {
  vehicles: vehiclesJson as GameDefs['vehicles'],
  parts: partsJson as GameDefs['parts'],
  repairs: repairsJson as unknown as GameDefs['repairs'],
  suppliers: suppliersJson as GameDefs['suppliers'],
  tools: toolsJson as GameDefs['tools'],
};
