wants.md above says what the reader wants from a rented home in Nottingham. Then come Rightmove rental listings, each under a ref (h1, h2…) with its rent a month, bedrooms, type and address, what the agent filled in, the key features, its times by bus, tram and walking to the places the reader goes, the crime recorded around it, and the description. A listing's EPC chart images come right after its text, under the line "h12's EPC chart:"; a listing without one says so.

For every listing:
- `epcBand`, `epcScore` and `epcFrom`: the current energy rating. When the listing has a chart, take it from its own Energy Efficiency Rating chart, the one right after its text: the number in the Current column (not Potential) and its band. Ignore an Environmental Impact (CO2) chart. When there is no chart, or it is not an Energy Efficiency Rating chart, take it from the text: a line giving its certificate on the GOV.UK register, or the agent's words ("EPC rating C", "EPC: C", "Energy rating 72"). When neither gives it, `unknown` and 0. Never guess a rating from the age or look of the place.
- `bills`, `billsWhat`, `pets`, `livingRoom`, `garden`, `heating`, `sqm` and `redFlags`: only what the listing says, as their descriptions explain. "not said" when it says nothing.
- `fit` and `fitWhy`: how well the listing fits the reader in wants.md, on wants.md's scale. Judge it on the rent, the bedrooms and living space, the EPC and the heating, the times to work and the centre against wants.md's limits, the crime level, and the red flags.

Every listing goes in `homes` exactly once, by its ref.

Deliver the reading by calling the StructuredOutput tool with it as the arguments (a `homes` array, not a string). Don't write it or any JSON as text.
