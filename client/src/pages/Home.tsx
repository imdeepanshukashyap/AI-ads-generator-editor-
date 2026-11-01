import Hero from "../components/Hero";
import Features from "../components/Features";
import Pricing from "../components/Pricing";
import Faq from "../components/Faq";
import CTA from "../components/CTA";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";

export default function Home() {
    const location = useLocation();

    useEffect(() => {
        if (location.state?.adminAccessDenied) {
            toast.error('This account does not have admin access.');
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);
    return (
        <>
            <Hero />
            <Features />
            <Pricing />
            <Faq />
            <CTA />
        </>
    )
}