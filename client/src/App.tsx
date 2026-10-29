import Navbar from './components/Navbar';
import Home from './pages/Home';
import SoftBackdrop from './components/SoftBackdrop';
import Footer from './components/Footer';
import LenisScroll from './components/lenis';
import { Navigate, Route, Routes } from 'react-router-dom';
import Genetator from './pages/Genetator';
import Result from './pages/Result';
import MyGenerations from './pages/MyGenerations';
import Community from './pages/Community';
import Plans from './pages/Plans';
import Loading from './pages/Loading';
import UserSignIn from './pages/UserSignIn';
import Admin from './pages/Admin';
import AdminProfile from './pages/AdminProfile';
import AdminRouteGuard from './components/AdminRouteGuard';
import {Toaster} from 'react-hot-toast'

function App() {
	return (
		<>	
			<Toaster toastOptions={{style: {background: '#333', color: "#fff"}}}/>
			<SoftBackdrop />
			<LenisScroll />
			<Navbar />

			<Routes>
				<Route path='/' element={<Home />}/>
				<Route path='/generate' element={<Genetator />}/>
				<Route path='/result/:projectId' element={<Result />}/>
				<Route path='/my-generations' element={<MyGenerations />}/>
				<Route path='/community' element={<Community />}/>
				<Route path='/plans' element={<Plans />}/>
				<Route path='/loading' element={<Loading />}/>
				<Route path='/sign-in/*' element={<UserSignIn />}/>
				<Route element={<AdminRouteGuard />}>
					<Route path='/admin/analytics' element={<Navigate to='/admin' replace />}/>
					<Route path='/admin/*' element={<Admin />}/>
					<Route path='/admin/profile' element={<AdminProfile />}/>
				</Route>
				
			</Routes>

			<Footer />
		</>
	);
}
export default App;