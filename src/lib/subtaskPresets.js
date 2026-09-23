// Subtask presets — a named, reusable checklist owned by a TEAM. Any member
// can apply one to a task; only owners/admins can create or change them
// (enforced by RLS in supabase-subtask-presets-migration.sql — the admin
// checks in the UI are convenience, not the security boundary).
//
// `items` is a plain array of strings, not subtask objects: a preset is a
// template, so it has no `done` state and no ids. Applying one mints fresh
// subtasks, which is why editing a preset never touches tasks it was already
// applied to.

import { supabase } from './supabase';
import { makeSubtask } from './subtasks';

export const MAX_PRESET_ITEMS = 50;
export const MAX_PRESET_NAME = 60;

// Tolerant reader — `items` is JSONB, so it can hold anything. Also accepts
// full subtask objects, so a preset built from an existing checklist works.
export function asPresetItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : String(v?.text ?? '')))
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PRESET_ITEMS);
}

// Preset → fresh subtask rows (new ids, nothing checked off).
export function presetToSubtasks(preset) {
  return asPresetItems(preset?.items).map(text => makeSubtask(text));
}

export async function fetchSubtaskPresets(teamId) {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from('subtask_presets')
    .select('id, name, items, created_at')
    .eq('team_id', teamId)
    .order('name');
  if (error || !data) return [];
  return data.map(p => ({ ...p, items: asPresetItems(p.items) }));
}

export async function createSubtaskPreset(teamId, userId, name, items) {
  const { data, error } = await supabase
    .from('subtask_presets')
    .insert({
      team_id: teamId,
      created_by: userId,
      name: name.trim().slice(0, MAX_PRESET_NAME),
      items: asPresetItems(items),
    })
    .select('id, name, items, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function updateSubtaskPreset(id, name, items) {
  const { error } = await supabase
    .from('subtask_presets')
    .update({
      name: name.trim().slice(0, MAX_PRESET_NAME),
      items: asPresetItems(items),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSubtaskPreset(id) {
  const { error } = await supabase.from('subtask_presets').delete().eq('id', id);
  if (error) throw error;
}
