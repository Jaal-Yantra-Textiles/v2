"use client"

import { motion } from "framer-motion"

type FadeInProps = {
    children: React.ReactNode
    delay?: number
    duration?: number
    className?: string
}

const FadeIn = ({ children, delay = 0, duration = 0.5, className }: FadeInProps) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration, delay, ease: "easeOut" }}
            className={className}
        >
            {children}
        </motion.div>
    )
}

export default FadeIn
