import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_BASEURL || 'http://localhost:5000',
    timeout: 300000 // 5 minutes timeout
})

export default api