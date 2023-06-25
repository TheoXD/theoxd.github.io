---
title: "New Rholang Parser+Runtime"
description: "I've written my very own Rholang parser and runtime. With my implementation there is no more need for normization/sorting (which was quite an expensive operation) and it's no longer a bottleneck🥳"
pubDate: "June 25 2023"
url: "#"
heroImage: "/new_rho2.JPG"
badge: "NEW"
---

To those wondering what I've been up to after my departure from Rhonix, well, I've been doing A LOT of Rust , in fact I've already written my very own Rholang parser and runtime. With my implementation there is no more need for normization/sorting (which was quite an expensive operation) and it's no longer a bottleneck 🎉

Why does it matter? Well, when I've been storing large amounts of data directly on chain such as videos, the normalizer would always sort the code as well as data structures such as maps to make sure it's serialized correctly in order to check for code equality, so that x | y = y | x .