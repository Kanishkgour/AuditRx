# MERN Stack Project

A full-stack web application built using the MERN stack.

## Tech Stack

* MongoDB
* Express.js
* React.js
* Node.js

## Features

* User authentication
* REST API
* MongoDB database
* Responsive frontend
* Full-stack MERN architecture

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

### 2. Install dependencies

Install frontend dependencies:

```bash
cd client
npm install
```

Install backend dependencies:

```bash
cd ../server
npm install
```

### 3. Configure environment variables

Create a `.env` file inside the server folder.

Copy the variables from:

```text
.env.example
```

and add your own credentials.

Example:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

### 4. Start the backend

```bash
cd server
npm run dev
```

### 5. Start the frontend

Open another terminal:

```bash
cd client
npm run dev
```

The application will now run locally.

## Important

Never commit your `.env` file or expose API keys, database passwords, JWT secrets, or other private credentials.
