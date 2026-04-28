import React from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

export default function GroupDetailScreen() {
  const { id } = useParams();
  const location = useLocation();
  const { type } = location.state || {};

  return (
    <div style={{ padding: 80, textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1>Group Detail Test</h1>
      <p>ID from URL: <strong>{id}</strong></p>
      <p>Type from state: <strong>{type || 'not provided'}</strong></p>
      <button onClick={() => window.history.back()}>Go Back</button>
    </div>
  );
}