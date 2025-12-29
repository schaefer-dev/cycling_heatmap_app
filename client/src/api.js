import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

// Rides
export const getRides = async (bikeType) => {
  const params = bikeType ? { bike_type: bikeType } : {};
  const { data } = await api.get('/rides', { params });
  return data;
};

export const getRide = async (id) => {
  const { data } = await api.get(`/rides/${id}`);
  return data;
};

export const importRides = async (files, bikeType) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('gpx', file);
  }
  formData.append('bike_type', bikeType);
  const { data } = await api.post('/rides', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export const updateRide = async (id, updates) => {
  const { data } = await api.put(`/rides/${id}`, updates);
  return data;
};

export const deleteRide = async (id) => {
  const { data } = await api.delete(`/rides/${id}`);
  return data;
};

// Sections
export const getSections = async (filters = {}) => {
  const { data } = await api.get('/sections', { params: filters });
  return data;
};

export const createSection = async (section) => {
  const { data } = await api.post('/sections', section);
  return data;
};

export const updateSection = async (id, updates) => {
  const { data } = await api.put(`/sections/${id}`, updates);
  return data;
};

export const deleteSection = async (id) => {
  const { data } = await api.delete(`/sections/${id}`);
  return data;
};

// Heatmap
export const getHeatmapData = async (bikeType) => {
  const params = bikeType ? { bike_type: bikeType } : {};
  const { data } = await api.get('/heatmap', { params });
  return data;
};

export const getMapBounds = async (bikeType) => {
  const params = bikeType ? { bike_type: bikeType } : {};
  const { data } = await api.get('/heatmap/bounds', { params });
  return data;
};

export const getStats = async () => {
  const { data } = await api.get('/heatmap/stats');
  return data;
};

export default api;
