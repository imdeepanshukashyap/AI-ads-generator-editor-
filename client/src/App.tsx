import Navbar from './components/Navbar';
import Home from './pages/Home';
import SoftBackdrop from './components/SoftBackdrop';
import Footer from './components/Footer';
import LenisScroll from './components/lenis';
import { Route, Routes } from 'react-router-dom';
import Genetator from './pages/Genetator';
import Result from './pages/Result';
import MyGenerations from './pages/MyGenerations';
import Community from './pages/Community';
import Plans from './pages/Plans';
import Loading from './pages/Loading';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsAndConditions from './pages/TermsAndConditions';
import RefundPolicy from './pages/RefundPolicy';
import Contact from './pages/Contact';
import About from './pages/About';
import ShippingPolicy from './pages/ShippingPolicy';
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
				<Route path='/privacy-policy' element={<PrivacyPolicy />}/>
				<Route path='/terms-and-conditions' element={<TermsAndConditions />}/>
				<Route path='/refund-policy' element={<RefundPolicy />}/>
				<Route path='/contact' element={<Contact />}/>
				<Route path='/about' element={<About />}/>
				<Route path='/shipping-policy' element={<ShippingPolicy />}/>
				
			</Routes>

			<Footer />
		</>
	);
}
export default App;