import { supabase } from './supabase';

export async function fetchMyTeams(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, joined_at, teams(*)')
    .eq('user_id', userId)
    .order('joined_at');
  if (error || !data) return [];
  return data
    .filter(r => r.teams)
    .map(r => ({ ...r.teams, role: r.role, joined_at: r.joined_at }));
}

export async function fetchTeamMembers(teamId) {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, role, joined_at, profiles(*)')
    .eq('team_id', teamId)
    .order('joined_at');
  if (error || !data) return [];
  return data
    .filter(r => r.profiles)
    .map(r => ({ ...r.profiles, role: r.role, joined_at: r.joined_at }));
}

export async function fetchGuestTeamInfo(slug) {
  if (!slug) return null;
  const { data } = await supabase
    .from('team_guest_info')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return data || null;
}

export async function createTeam(name) {
  const { data, error } = await supabase.rpc('create_team', { p_name: name });
  if (error) throw error;
  return data;
}

export async function joinTeamByCode(code) {
  const { data, error } = await supabase.rpc('join_team_by_code', { p_code: code });
  if (error) throw error;
  return data;
}

export async function renameTeam(teamId, name) {
  const { data, error } = await supabase.rpc('rename_team', { p_team_id: teamId, p_name: name });
  if (error) throw error;
  return data;
}

export async function regenerateInviteCode(teamId) {
  const { data, error } = await supabase.rpc('regenerate_invite_code', { p_team_id: teamId });
  if (error) throw error;
  return data;
}

export async function setMemberRole(teamId, userId, role) {
  const { error } = await supabase.rpc('set_member_role', { p_team_id: teamId, p_user_id: userId, p_role: role });
  if (error) throw error;
}

export async function removeMember(teamId, userId) {
  const { error } = await supabase.rpc('remove_team_member', { p_team_id: teamId, p_user_id: userId });
  if (error) throw error;
}

export async function setTeamGamification(teamId, enabled) {
  const { error } = await supabase.rpc('set_team_gamification', { p_team_id: teamId, p_enabled: enabled });
  if (error) throw error;
}
