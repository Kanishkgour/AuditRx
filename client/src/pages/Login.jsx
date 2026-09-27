import { useNavigate } from 'react-router-dom';

import '../styles/login.css';

function Login() {
  const navigate = useNavigate();

  function handleLogin(event) {
    event.preventDefault();
    navigate('/home');
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-logo">✚</div>

        <h1>Welcome to LekhaRx</h1>
        <p>AI-powered clinical document intelligence</p>

        <form onSubmit={handleLogin}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="doctor@hospital.com"
            defaultValue="doctor@hospital.com"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            defaultValue="password123"
            required
          />

          <button type="submit" className="login-button">
            Sign In →
          </button>
        </form>
      </div>
    </main>
  );
}

export default Login;
