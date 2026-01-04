import { Button, Heading } from "@medusajs/ui"

const Hero = () => {
  return (
    <div className="h-[75vh] w-full border-b border-ui-border-base relative bg-gray-900 overflow-hidden">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(139,92,246,0.15)_0%,_transparent_60%)] animate-breathing" />
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center small:p-32 gap-6">
        <span>
          <Heading
            level="h1"
            className="text-6xl font-bold bg-gradient-to-r from-violet-600 to-rose-500 bg-clip-text text-transparent"
          >
            Cici Label
          </Heading>
          <Heading
            level="h2"
            className="text-2xl leading-9 font-medium"
          >
            <span className="bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">With Care, </span>
            <span className="bg-gradient-to-r from-green-200 via-teal-300 to-blue-400 bg-clip-text text-transparent">Through Inversion: </span>
            <span className="bg-gradient-to-r from-yellow-200 via-orange-300 to-red-400 bg-clip-text text-transparent">Compassion Meets Impermanence</span>
          </Heading>
        </span>
        <a
          href="/design"
        >
          <Button variant="secondary">
            Design your first piece
          </Button>
        </a>
      </div>
    </div>
  )
}

export default Hero
