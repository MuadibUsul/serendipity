# PostgreSQL 17 + pgvector 0.8 + PostGIS 3, the server the migrations target
# (ADR-0003). For the dev stack and CI; production uses the managed or hosted
# server chosen in ser-p00-02.
#
# The pgvector image is the official postgres:17 image on Debian bookworm,
# whose apt.postgresql.org repository also ships PostGIS.
FROM pgvector/pgvector:0.8.1-pg17-bookworm

# PostGIS comes from the same repository as the server and is built against
# its newest 17.x. The base image pins an older 17.x, so upgrade the server in
# the same step: otherwise postgis-3.so can need a symbol the older server
# lacks (seen 2026-11-13: "undefined symbol: heap_datum_check", 17.8 with
# PostGIS 3.7.0). A minor upgrade keeps the data format, and pgvector, built
# for the base 17.x, loads on any later 17.x.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17 postgresql-17-postgis-3 \
  && rm -rf /var/lib/apt/lists/*
